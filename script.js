document.addEventListener("DOMContentLoaded", () => {
  let robotStatus = "Null"
  let batteryLevel = "Null"
  let currentLocation = "Null"
  let isConnected = false
  let port
  let markers = []
  let map
  let robotMarker
  let geofence
  let userLocation

  const currentStatusElement = document.getElementById("current-status")
  const batteryLevelElement = document.getElementById("battery-level")
  const currentLocationElement = document.getElementById("current-location")
  const startDelivery = document.getElementById("start-delivery")
  const pauseDelivery = document.getElementById("pause-delivery")
  const returnToBase = document.getElementById("return-to-base")
  const connectArduinoButton = document.getElementById("connect-arduino")
  const connectionStatus = document.getElementById("connection-status")

  // Get user's geolocation
  function getUserLocation() {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          userLocation = [position.coords.latitude, position.coords.longitude]
          initMap()
        },
        (error) => {
          console.error("Error getting user location:", error)
          initMap([0, 0]) // Default location if geolocation fails
        },
      )
    } else {
      console.error("Geolocation is not supported by this browser.")
      initMap([0, 0]) // Default location if geolocation is not supported
    }
  }

  // Initialize map
  function initMap() {
    map = L.map("map-container").setView(userLocation, 20) // High zoom level for small area
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map)

    // Create a 2m x 2m geofence
    const geofenceSize = 0.000018 // Approximately 2 meters in degrees
    const geofenceBounds = [
      [userLocation[0] - geofenceSize / 2, userLocation[1] - geofenceSize / 2],
      [userLocation[0] + geofenceSize / 2, userLocation[1] + geofenceSize / 2],
    ]
    geofence = L.rectangle(geofenceBounds, { color: "#ff7800", weight: 1 }).addTo(map)
    map.fitBounds(geofenceBounds)

    robotMarker = L.marker(userLocation, {
      icon: L.icon({
        iconUrl: "https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      }),
    }).addTo(map)

    map.on("click", onMapClick)
  }

  function onMapClick(e) {
    if (isWithinGeofence(e.latlng)) {
      placeMarker(e.latlng.lat, e.latlng.lng)
      sendCommandToRobot(e.latlng.lat, e.latlng.lng)
    } else {
      alert("Please select a point within the designated area.")
    }
  }

  function isWithinGeofence(latlng) {
    return geofence.getBounds().contains(latlng)
  }

  function placeMarker(lat, lng) {
    const marker = L.marker([lat, lng]).addTo(map)
    markers.push(marker)
  }

  function clearMarkers() {
    markers.forEach((marker) => map.removeLayer(marker))
    markers = []
  }

  async function sendCommandToRobot(lat, lng) {
    if (!isConnected) {
      alert("Please connect to Arduino first!")
      return
    }

    console.log(`Sending command to move to: (${lat}, ${lng})`)

    try {
      await sendCommandToArduino(lat, lng)
      animateRobotToPosition(lat, lng)
    } catch (error) {
      console.error("Error sending command to Arduino:", error)
      alert("Failed to send command to Arduino. Please check the connection.")
    }
  }

  async function sendCommandToArduino(lat, lng) {
    const command = JSON.stringify({ lat, lng })
    const encoder = new TextEncoder()
    const writer = port.writable.getWriter()
    await writer.write(encoder.encode(command))
    writer.releaseLock()
  }

  function animateRobotToPosition(lat, lng) {
    const frames = 100
    const duration = 2000 // 2 seconds
    const startLat = robotMarker.getLatLng().lat
    const startLng = robotMarker.getLatLng().lng
    let frame = 0

    function animate() {
      if (frame < frames) {
        const progress = frame / frames
        const newLat = startLat + (lat - startLat) * progress
        const newLng = startLng + (lng - startLng) * progress
        robotMarker.setLatLng([newLat, newLng])
        frame++
        setTimeout(animate, duration / frames)
      } else {
        robotMarker.setLatLng([lat, lng])
        updateRobotStatus()
        removeReachedMarker(lat, lng)
      }
    }

    animate()
  }

  function removeReachedMarker(lat, lng) {
    const reachedMarkerIndex = markers.findIndex((marker) => {
      const markerLatLng = marker.getLatLng()
      return markerLatLng.lat === lat && markerLatLng.lng === lng
    })

    if (reachedMarkerIndex !== -1) {
      const reachedMarker = markers[reachedMarkerIndex]
      map.removeLayer(reachedMarker)
      markers.splice(reachedMarkerIndex, 1)
    }
  }

  function updateRobotStatus() {
    if (isConnected) {
      robotStatus = "Moving"
      const { lat, lng } = robotMarker.getLatLng()
      currentLocation = `(${lat.toFixed(6)}, ${lng.toFixed(6)})`
    } else {
      robotStatus = "Null"
      currentLocation = "Null"
    }

    currentStatusElement.textContent = robotStatus
    currentLocationElement.textContent = currentLocation
  }

  // Control button handlers
  startDelivery.addEventListener("click", () => {
    if (!isConnected) {
      alert("Please connect to Arduino first!")
      return
    }
    robotStatus = "In Delivery"
    updateRobotStatus()
    if (markers.length > 0) {
      const nextMarker = markers[0].getLatLng()
      sendCommandToRobot(nextMarker.lat, nextMarker.lng)
    }
  })

  pauseDelivery.addEventListener("click", () => {
    if (isConnected) {
      robotStatus = "Paused"
      updateRobotStatus()
      // Here you would send a pause command to Arduino
    }
  })

  returnToBase.addEventListener("click", () => {
    if (!isConnected) {
      alert("Please connect to Arduino first!")
      return
    }
    robotStatus = "Returning"
    updateRobotStatus()
    sendCommandToRobot(userLocation[0], userLocation[1]) // Return to base coordinates
    clearMarkers()
  })

  // Arduino connection
  connectArduinoButton.addEventListener("click", async () => {
    if (isConnected) {
      await disconnectArduino()
    } else {
      await connectArduino()
    }
  })

  async function connectArduino() {
    try {
      port = await navigator.serial.requestPort()
      await port.open({ baudRate: 9600 })

      isConnected = true
      connectArduinoButton.textContent = "Disconnect Arduino"
      connectionStatus.textContent = "Connected"

      // Set up reading from Arduino
      const reader = port.readable.getReader()
      readFromArduino(reader)
    } catch (error) {
      console.error("Error connecting to Arduino:", error)
      alert("Failed to connect to Arduino. Please try again.")
    }
  }

  async function disconnectArduino() {
    try {
      await port.close()
      isConnected = false
      connectArduinoButton.textContent = "Connect Arduino"
      connectionStatus.textContent = "Not connected"
      robotStatus = "Null"
      batteryLevel = "Null"
      currentLocation = "Null"
      updateRobotStatus()
    } catch (error) {
      console.error("Error disconnecting from Arduino:", error)
      alert("Failed to disconnect from Arduino. Please try again.")
    }
  }

  async function readFromArduino(reader) {
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          reader.releaseLock()
          break
        }
        // Process the data received from Arduino
        const data = JSON.parse(new TextDecoder().decode(value))

        // Update robot status based on received data
        if (data.battery !== undefined) {
          batteryLevel = data.battery + "%"
          batteryLevelElement.textContent = batteryLevel
        }
        if (data.status !== undefined) {
          robotStatus = data.status
          currentStatusElement.textContent = robotStatus
        }
        if (data.location !== undefined) {
          currentLocation = `(${data.location.lat.toFixed(6)}, ${data.location.lng.toFixed(6)})`
          currentLocationElement.textContent = currentLocation
          robotMarker.setLatLng([data.location.lat, data.location.lng])
        }
      }
    } catch (error) {
      console.error("Error reading from Arduino:", error)
    }
  }

  // Initialize Leaflet
  const L = window.L

  // Initialize by getting user location and setting up the map
  getUserLocation()
})

