const io = window.io
const backendUrl = `https://livechat-docker-production.up.railway.app`

class ChatApp {
  constructor() {
    this.socket = null
    this.currentRoom = "general"
    this.clearTimerInterval = null
    this.statusInterval = null
    this.roomRefreshInterval = null // Auto-refresh timer
    this.typingTimeout = null
    this.isTyping = false
    this.hasWelcomeMessage = false
    this.currentUserCount = 0
    this.currentTypingCount = 0

    // Elements
    this.roomTitle = document.getElementById("roomTitle")
    this.chatMessages = document.getElementById("chatMessages")
    this.messageInput = document.getElementById("messageInput")
    this.sendButton = document.getElementById("sendButton")
    this.status = document.getElementById("status")
    this.charCount = document.getElementById("charCount")
    this.clearTimer = document.getElementById("clearTimer")

    // Sidebar
    this.roomsBtn = document.getElementById("roomsBtn")
    this.roomsSidebar = document.getElementById("roomsSidebar")
    this.closeSidebar = document.getElementById("closeSidebar")
    this.roomsList = document.getElementById("roomsList")

    // Modal
    this.createBtn = document.getElementById("createBtn")
    this.createModal = document.getElementById("createModal")
    this.closeModal = document.getElementById("closeModal")
    this.cancelCreate = document.getElementById("cancelCreate")
    this.confirmCreate = document.getElementById("confirmCreate")
    this.roomName = document.getElementById("roomName")
    this.clearInterval = document.getElementById("clearInterval")
    this.roomDuration = document.getElementById("roomDuration")

    this.overlay = document.getElementById("overlay")

    this.init()
  }

  init() {
    this.connectSocket()
    this.setupEventListeners()
    this.updateCharCount()
    this.createTypingIndicator()

    // Auto-join general room
    setTimeout(() => {
      this.joinRoom("general")
    }, 1000)
  }

  createTypingIndicator() {
    // Create typing indicator element
    const typingIndicator = document.createElement("div")
    typingIndicator.id = "typingIndicator"
    typingIndicator.className = "typing-indicator"
    typingIndicator.style.display = "none"
    typingIndicator.innerHTML = `
      <div class="typing-content">
        <div class="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span class="typing-text">Someone is typing...</span>
      </div>
    `

    // Insert before chat input
    const chatInput = document.querySelector(".chat-input")
    chatInput.parentNode.insertBefore(typingIndicator, chatInput)
  }

  connectSocket() {
    console.log("Connecting to:", backendUrl)

    this.socket = io(backendUrl, {
      transports: ["websocket", "polling"],
      timeout: 5000,
    })

    this.socket.on("connect", () => {
      console.log("Connected to server")
      this.updateStatus("Connected", "connected")
    })

    this.socket.on("disconnect", () => {
      console.log("Disconnected from server")
      this.updateStatus("Disconnected", "disconnected")
      this.stopRoomRefresh() // Stop auto-refresh when disconnected
      this.hideTypingIndicator()
    })

    this.socket.on("connect_error", (error) => {
      console.error("Connection error:", error)
      this.updateStatus("Error", "disconnected")
    })

    this.socket.on("room_joined", (data) => {
      console.log("Joined room:", data)
      this.handleRoomJoined(data)
    })

    this.socket.on("new_message", (data) => {
      this.addMessage(data.message, data.timestamp, false)
    })

    this.socket.on("messages_cleared", (data) => {
      console.log("Messages cleared")
      this.clearChat()
      this.addSystemMessage(data.message, "clear-notification")
      this.startClearTimer(data.time_until_clear)
      this.hasWelcomeMessage = false
    })

    this.socket.on("room_expired", (data) => {
      this.addSystemMessage(data.message, "expiry-warning")
      setTimeout(() => {
        this.joinRoom("general")
      }, 5000)
    })

    this.socket.on("room_status", (data) => {
      if (data.time_until_clear !== undefined) {
        this.startClearTimer(data.time_until_clear)
      }
      if (data.user_count !== undefined) {
        this.currentUserCount = data.user_count
        this.updateRoomTitle()
      }
      if (data.typing_count !== undefined) {
        this.currentTypingCount = data.typing_count
        this.updateTypingIndicator()
      }
    })

    this.socket.on("user_count_updated", (data) => {
      if (data.room_id === this.currentRoom) {
        this.currentUserCount = data.user_count
        this.updateRoomTitle()
      }
    })

    this.socket.on("typing_update", (data) => {
      this.currentTypingCount = data.typing_count
      this.updateTypingIndicator()
    })

    this.socket.on("error", (data) => {
      console.error("Socket error:", data.message)
    })
  }

  setupEventListeners() {
    // Chat
    this.sendButton.addEventListener("click", () => this.sendMessage())
    this.messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        this.sendMessage()
      }
    })
    this.messageInput.addEventListener("input", () => {
      this.updateCharCount()
      this.handleTyping()
    })

    // Sidebar
    this.roomsBtn.addEventListener("click", () => this.toggleSidebar())
    this.closeSidebar.addEventListener("click", () => this.hideSidebar())

    // Modal
    this.createBtn.addEventListener("click", () => this.showCreateModal())
    this.closeModal.addEventListener("click", () => this.hideCreateModal())
    this.cancelCreate.addEventListener("click", () => this.hideCreateModal())
    this.confirmCreate.addEventListener("click", () => this.createRoom())

    // Overlay
    this.overlay.addEventListener("click", () => {
      this.hideSidebar()
      this.hideCreateModal()
    })

    // Focus input
    this.messageInput.focus()
  }

  handleTyping() {
    if (!this.socket || !this.socket.connected || !this.currentRoom) return

    const hasText = this.messageInput.value.trim().length > 0

    if (hasText && !this.isTyping) {
      // Start typing
      this.isTyping = true
      this.socket.emit("typing_start", { room_id: this.currentRoom })
    }

    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout)
    }

    // Set timeout to stop typing after 2 seconds of inactivity
    this.typingTimeout = setTimeout(() => {
      if (this.isTyping) {
        this.isTyping = false
        this.socket.emit("typing_stop", { room_id: this.currentRoom })
      }
    }, 2000)

    // Stop typing immediately if input is empty
    if (!hasText && this.isTyping) {
      this.isTyping = false
      this.socket.emit("typing_stop", { room_id: this.currentRoom })
    }
  }

  updateTypingIndicator() {
    const typingIndicator = document.getElementById("typingIndicator")
    const typingText = typingIndicator.querySelector(".typing-text")

    if (this.currentTypingCount > 0) {
      let text = ""
      if (this.currentTypingCount === 1) {
        text = "Someone is typing..."
      } else {
        text = `${this.currentTypingCount} people are typing...`
      }

      typingText.textContent = text
      this.showTypingIndicator()
    } else {
      this.hideTypingIndicator()
    }
  }

  showTypingIndicator() {
    const typingIndicator = document.getElementById("typingIndicator")
    typingIndicator.style.display = "block"
    // Scroll to bottom to show typing indicator
    setTimeout(() => this.scrollToBottom(), 100)
  }

  hideTypingIndicator() {
    const typingIndicator = document.getElementById("typingIndicator")
    typingIndicator.style.display = "none"
  }

  joinRoom(roomId) {
    // Stop typing in current room
    if (this.isTyping && this.currentRoom) {
      this.isTyping = false
      this.socket.emit("typing_stop", { room_id: this.currentRoom })
    }

    this.currentRoom = roomId
    this.hasWelcomeMessage = false
    this.currentUserCount = 0
    this.currentTypingCount = 0
    this.hideTypingIndicator()
    this.socket.emit("join_room", { room_id: roomId })
  }

  handleRoomJoined(data) {
    this.roomTitle.textContent = data.room_name
    this.currentUserCount = data.user_count || 0
    this.currentTypingCount = data.typing_count || 0
    this.updateRoomTitle()
    this.updateTypingIndicator()

    // Clear all messages first
    this.clearAllMessages()

    // Load existing messages
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach((msg) => {
        this.addMessage(msg.message, msg.timestamp, false)
      })
      this.hasWelcomeMessage = true
    } else {
      if (!this.hasWelcomeMessage) {
        const welcomeMsg = data.is_default
          ? "Welcome to General Chat! Messages clear every 5 minutes."
          : `Welcome to ${data.room_name}! Messages clear every ${data.clear_interval} minutes.`
        this.addSystemMessage(welcomeMsg, "welcome-message")
        this.hasWelcomeMessage = true
      }
    }

    // Start timer
    this.startClearTimer(data.time_until_clear)
    this.startStatusPolling()
  }

  updateRoomTitle() {
    const baseTitle = this.roomTitle.textContent.split(" (")[0] // Remove existing user count
    const userCountText = this.currentUserCount > 0 ? ` (${this.currentUserCount} online)` : ""
    this.roomTitle.textContent = baseTitle + userCountText
  }

  sendMessage() {
    const message = this.messageInput.value.trim()

    if (message && this.socket && this.socket.connected) {
      // Stop typing when sending message
      if (this.isTyping) {
        this.isTyping = false
        this.socket.emit("typing_stop", { room_id: this.currentRoom })
      }

      this.socket.emit("send_message", {
        room_id: this.currentRoom,
        message: message,
      })

      this.addMessage(message, this.getCurrentTime(), true)
      this.messageInput.value = ""
      this.updateCharCount()
      this.messageInput.focus()
    }
  }

  addMessage(message, timestamp, isUser = false) {
    const messageDiv = document.createElement("div")
    messageDiv.className = `message ${isUser ? "user" : "other"}`

    messageDiv.innerHTML = `
      <div class="message-content">${this.escapeHtml(message)}</div>
      <div class="message-time">${timestamp}</div>
    `

    this.chatMessages.appendChild(messageDiv)
    this.scrollToBottom()
  }

  addSystemMessage(message, className = "welcome-message") {
    const messageDiv = document.createElement("div")
    messageDiv.className = className
    messageDiv.textContent = message

    this.chatMessages.appendChild(messageDiv)
    this.scrollToBottom()
  }

  clearChat() {
    const messages = this.chatMessages.querySelectorAll(".message, .clear-notification, .expiry-warning")
    messages.forEach((msg) => msg.remove())
  }

  clearAllMessages() {
    this.chatMessages.innerHTML = ""
    this.hasWelcomeMessage = false
  }

  startClearTimer(seconds) {
    if (this.clearTimerInterval) {
      clearInterval(this.clearTimerInterval)
    }

    let timeRemaining = seconds

    const updateTimer = () => {
      const minutes = Math.floor(timeRemaining / 60)
      const secs = timeRemaining % 60
      this.clearTimer.textContent = `${minutes}:${secs.toString().padStart(2, "0")}`

      if (timeRemaining <= 30) {
        this.clearTimer.classList.add("warning")
      } else {
        this.clearTimer.classList.remove("warning")
      }

      timeRemaining--

      if (timeRemaining < 0) {
        this.socket.emit("get_room_status", { room_id: this.currentRoom })
      }
    }

    updateTimer()
    this.clearTimerInterval = setInterval(updateTimer, 1000)
  }

  startStatusPolling() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval)
    }

    this.statusInterval = setInterval(() => {
      if (this.currentRoom && this.socket && this.socket.connected) {
        this.socket.emit("get_room_status", { room_id: this.currentRoom })
      }
    }, 30000)
  }

  // Auto-refresh room list
  startRoomRefresh() {
    if (this.roomRefreshInterval) {
      clearInterval(this.roomRefreshInterval)
    }

    this.roomRefreshInterval = setInterval(() => {
      if (this.roomsSidebar.classList.contains("active")) {
        this.loadRooms()
      }
    }, 30000) // Refresh every 30 seconds
  }

  stopRoomRefresh() {
    if (this.roomRefreshInterval) {
      clearInterval(this.roomRefreshInterval)
      this.roomRefreshInterval = null
    }
  }

  // Sidebar methods
  toggleSidebar() {
    if (this.roomsSidebar.classList.contains("active")) {
      this.hideSidebar()
    } else {
      this.showSidebar()
    }
  }

  showSidebar() {
    this.roomsSidebar.classList.add("active")
    this.overlay.classList.add("active")
    this.loadRooms()
    this.startRoomRefresh() // Start auto-refresh when sidebar opens
  }

  hideSidebar() {
    this.roomsSidebar.classList.remove("active")
    this.overlay.classList.remove("active")
    this.stopRoomRefresh() // Stop auto-refresh when sidebar closes
  }

  async loadRooms() {
    try {
      const response = await fetch(`${backendUrl}/rooms`)
      const data = await response.json()
      this.displayRooms(data.rooms || [])
    } catch (error) {
      console.error("Error loading rooms:", error)
      this.roomsList.innerHTML = '<div class="error">Failed to load rooms</div>'
    }
  }

  displayRooms(rooms) {
    if (rooms.length === 0) {
      this.roomsList.innerHTML = '<div class="no-rooms">No rooms available</div>'
      return
    }

    this.roomsList.innerHTML = rooms
      .map(
        (room) => `
      <div class="room-item ${room.room_id === this.currentRoom ? "active" : ""}" 
           onclick="app.selectRoom('${room.room_id}')">
        <div class="room-info">
          <h3>${this.escapeHtml(room.name)} ${room.is_default ? "(Default)" : ""}</h3>
          <div class="room-details">
            <span class="user-count">👥 ${room.user_count} online</span>
            <span>${room.message_count} messages</span>
            <span>Clears every ${room.clear_interval}min</span>
          </div>
        </div>
      </div>
    `,
      )
      .join("")
  }

  selectRoom(roomId) {
    this.joinRoom(roomId)
    this.hideSidebar()
  }

  // Modal methods
  showCreateModal() {
    this.createModal.classList.add("active")
    this.overlay.classList.add("active")
    this.roomName.focus()
  }

  hideCreateModal() {
    this.createModal.classList.remove("active")
    this.overlay.classList.remove("active")
    this.roomName.value = ""
  }

  async createRoom() {
    const name = this.roomName.value.trim()
    const clearInterval = Number.parseInt(this.clearInterval.value)
    const roomDuration = Number.parseInt(this.roomDuration.value)

    if (!name) {
      alert("Please enter a room name")
      return
    }

    try {
      const response = await fetch(`${backendUrl}/create-room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          clear_interval: clearInterval,
          room_duration: roomDuration,
        }),
      })

      const data = await response.json()

      if (data.success) {
        this.hideCreateModal()
        this.joinRoom(data.room_id)
      } else {
        alert(data.error || "Failed to create room")
      }
    } catch (error) {
      console.error("Error creating room:", error)
      alert("Failed to create room")
    }
  }

  // Utility methods
  updateCharCount() {
    const count = this.messageInput.value.length
    this.charCount.textContent = count

    if (count > 450) {
      this.charCount.parentElement.classList.add("warning")
    } else {
      this.charCount.parentElement.classList.remove("warning")
    }
  }

  updateStatus(text, className) {
    this.status.textContent = text
    this.status.className = `status ${className}`
  }

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight
  }

  getCurrentTime() {
    return new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  escapeHtml(text) {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }
}

// Global app instance
let app

document.addEventListener("DOMContentLoaded", () => {
  app = new ChatApp()
})
