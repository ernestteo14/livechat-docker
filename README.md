# Anonymous Live Chat App

A real-time anonymous chat application where messages are automatically deleted every 5 minutes.

## Features

- 🔥 Real-time messaging using WebSockets
- 👤 Anonymous chat (no registration required)
- 🗑️ Auto-delete messages every 5 minutes
- 📱 Responsive design
- 🐳 Docker containerized
- 🚀 Easy deployment

## Tech Stack

**Frontend:**
- HTML5, CSS3, JavaScript
- Socket.IO client
- Nginx (for serving static files)

**Backend:**
- Python Flask
- Flask-SocketIO
- WebSocket support

## Quick Start

### Using Docker Compose (Recommended)

1. Clone the repository
2. Run the application:
\`\`\`bash
docker-compose up --build
\`\`\`

3. Open your browser and go to:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000

### Manual Setup

**Backend:**
\`\`\`bash
cd backend
pip install -r requirements.txt
python app.py
\`\`\`

**Frontend:**
\`\`\`bash
cd frontend
# Serve with any static file server
python -m http.server 8000
\`\`\`

## Project Structure

\`\`\`
├── backend/
│   ├── app.py              # Flask application
│   ├── requirements.txt    # Python dependencies
│   └── Dockerfile         # Backend Docker config
├── frontend/
│   ├── index.html         # Main HTML file
│   ├── style.css          # Styling
│   ├── script.js          # JavaScript logic
│   ├── nginx.conf         # Nginx configuration
│   └── Dockerfile         # Frontend Docker config
├── docker-compose.yml     # Docker Compose configuration
└── README.md             # This file
\`\`\`

## Configuration

### Environment Variables

You can customize the application by setting these environment variables:

- `FLASK_ENV`: Set to 'development' for debug mode
- `FLASK_DEBUG`: Set to '1' for debug mode

### Message Clearing Interval

To change the auto-delete interval, modify the `time.sleep(300)` value in `backend/app.py`:
- 300 seconds = 5 minutes
- 600 seconds = 10 minutes
- etc.

## API Endpoints

### WebSocket Events

**Client to Server:**
- `send_message`: Send a new message
- `clear_chat`: Manually clear all messages

**Server to Client:**
- `new_message`: Receive new message
- `load_messages`: Load existing messages on connect
- `messages_cleared`: Notification when messages are cleared

### HTTP Endpoints

- `GET /`: Server status
- `GET /health`: Health check with message count

## Development

### Running in Development Mode

1. Backend:
\`\`\`bash
cd backend
export FLASK_ENV=development
export FLASK_DEBUG=1
python app.py
\`\`\`

2. Frontend:
\`\`\`bash
cd frontend
# Use live server or any development server
\`\`\`

### Building for Production

\`\`\`bash
docker-compose up --build -d
\`\`\`

## Deployment

### Docker Deployment

1. Build and run:
\`\`\`bash
docker-compose up -d --build
\`\`\`

2. Check logs:
\`\`\`bash
docker-compose logs -f
\`\`\`

3. Stop services:
\`\`\`bash
docker-compose down
\`\`\`

### Manual Deployment

1. Set up a reverse proxy (nginx/apache)
2. Configure SSL certificates
3. Set environment variables for production
4. Use a process manager like PM2 or systemd

## Security Considerations

- Messages are stored in memory only
- No user authentication (anonymous)
- Rate limiting should be implemented for production
- Consider adding message content filtering
- CORS is enabled for development (restrict in production)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the MIT License.
