from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import threading
import time
import uuid
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
CORS(app, origins="*", allow_headers=["Content-Type"], methods=["GET", "POST"])

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading', logger=True, engineio_logger=True)

# Store rooms and their data
rooms = {}
# Track users in each room
room_users = {}  # room_id -> set of user_ids
user_rooms = {}  # user_id -> room_id
# Track typing users
typing_users = {}  # room_id -> set of user_ids who are typing
MAX_MESSAGES = 100

class ChatRoom:
    def __init__(self, room_id, name, clear_interval_minutes=5, room_duration_minutes=0):
        self.room_id = room_id
        self.name = name
        self.messages = []
        self.created_at = time.time()
        self.clear_interval = clear_interval_minutes * 60  # Convert to seconds
        self.room_duration = room_duration_minutes * 60 if room_duration_minutes > 0 else None
        self.last_clear_time = time.time()
        self.is_active = True
        
    def add_message(self, message, timestamp):
        message_data = {
            'message': message,
            'timestamp': timestamp,
            'id': len(self.messages) + 1
        }
        self.messages.append(message_data)
        
        if len(self.messages) > MAX_MESSAGES:
            self.messages.pop(0)
            
        return message_data
    
    def clear_messages(self):
        self.messages.clear()
        self.last_clear_time = time.time()
    
    def get_time_until_clear(self):
        elapsed = time.time() - self.last_clear_time
        return max(0, int(self.clear_interval - elapsed))
    
    def get_time_until_expiry(self):
        if not self.room_duration:
            return None
        elapsed = time.time() - self.created_at
        return max(0, int(self.room_duration - elapsed))
    
    def should_clear_messages(self):
        return time.time() - self.last_clear_time >= self.clear_interval
    
    def should_expire(self):
        if not self.room_duration:
            return False
        elapsed = time.time() - self.created_at
        return elapsed >= self.room_duration

# Create default room
default_room = ChatRoom("general", "General Chat", 5, 0)  # 5 min clear, no expiry
rooms["general"] = default_room
room_users["general"] = set()
typing_users["general"] = set()

def get_user_count(room_id):
    """Get the number of users in a room"""
    return len(room_users.get(room_id, set()))

def get_typing_count(room_id, exclude_user_id=None):
    """Get the number of users typing in a room, optionally excluding a specific user"""
    typing_set = typing_users.get(room_id, set())
    if exclude_user_id and exclude_user_id in typing_set:
        return len(typing_set) - 1
    return len(typing_set)

def add_user_to_room(user_id, room_id):
    """Add user to room tracking"""
    # Remove user from previous room if any
    if user_id in user_rooms:
        old_room = user_rooms[user_id]
        if old_room in room_users:
            room_users[old_room].discard(user_id)
        # Remove from typing in old room
        if old_room in typing_users:
            typing_users[old_room].discard(user_id)
    
    # Add user to new room
    if room_id not in room_users:
        room_users[room_id] = set()
    if room_id not in typing_users:
        typing_users[room_id] = set()
    
    room_users[room_id].add(user_id)
    user_rooms[user_id] = room_id

def remove_user_from_room(user_id):
    """Remove user from room tracking"""
    if user_id in user_rooms:
        room_id = user_rooms[user_id]
        if room_id in room_users:
            room_users[room_id].discard(user_id)
        # Remove from typing
        if room_id in typing_users:
            typing_users[room_id].discard(user_id)
        del user_rooms[user_id]

def set_user_typing(user_id, room_id, is_typing):
    """Set user typing status"""
    if room_id not in typing_users:
        typing_users[room_id] = set()
    
    if is_typing:
        typing_users[room_id].add(user_id)
    else:
        typing_users[room_id].discard(user_id)

def room_manager():
    """Background thread to manage room timers"""
    while True:
        time.sleep(5)  # Check every 5 seconds
        
        for room_id, room in list(rooms.items()):
            if not room.is_active:
                continue
                
            # Check if room should expire (skip default room)
            if room_id != "general" and room.should_expire():
                room.is_active = False
                socketio.emit('room_expired', {
                    'message': f'Room "{room.name}" has expired.'
                }, room=room_id)
                
                # Remove room after 10 seconds
                def delayed_removal(r_id):
                    time.sleep(10)
                    if r_id in rooms and r_id != "general":
                        del rooms[r_id]
                        # Clean up user tracking
                        if r_id in room_users:
                            del room_users[r_id]
                        if r_id in typing_users:
                            del typing_users[r_id]
                
                threading.Thread(target=delayed_removal, args=(room_id,), daemon=True).start()
                continue
            
            # Check if messages should be cleared
            if room.should_clear_messages():
                room.clear_messages()
                socketio.emit('messages_cleared', {
                    'message': 'Messages have been cleared!',
                    'time_until_clear': room.clear_interval,
                    'time_until_expiry': room.get_time_until_expiry()
                }, room=room_id)

# Start the room manager thread
manager_thread = threading.Thread(target=room_manager, daemon=True)
manager_thread.start()

@app.route('/')
def index():
    return "Flask SocketIO Server is running!"

@app.route('/health')
def health():
    active_rooms = sum(1 for room in rooms.values() if room.is_active)
    total_users = sum(len(users) for users in room_users.values())
    return {
        'status': 'healthy', 
        'active_rooms': active_rooms,
        'total_rooms': len(rooms),
        'total_users': total_users
    }

@app.route('/create-room', methods=['POST'])
def create_room():
    try:
        data = request.get_json()
        
        room_name = data.get('name', '').strip()
        clear_interval = int(data.get('clear_interval', 5))
        room_duration = int(data.get('room_duration', 0))
        
        if not room_name or len(room_name) < 1:
            return jsonify({'error': 'Room name is required'}), 400
        
        if clear_interval < 1 or clear_interval > 60:
            return jsonify({'error': 'Clear interval must be between 1 and 60 minutes'}), 400
        
        if room_duration < 0 or room_duration > 10:  # Max 10 minutes
            return jsonify({'error': 'Room duration must be between 0 and 10 minutes'}), 400
        
        # Generate unique room ID
        room_id = str(uuid.uuid4())[:8]
        while room_id in rooms:
            room_id = str(uuid.uuid4())[:8]
        
        room = ChatRoom(room_id, room_name, clear_interval, room_duration)
        rooms[room_id] = room
        room_users[room_id] = set()  # Initialize user tracking
        typing_users[room_id] = set()  # Initialize typing tracking
        
        return jsonify({
            'success': True,
            'room_id': room_id,
            'room_name': room_name,
            'clear_interval': clear_interval,
            'room_duration': room_duration
        })
        
    except Exception as e:
        print(f"Error creating room: {e}")
        return jsonify({'error': 'Failed to create room'}), 500

@app.route('/rooms')
def get_rooms():
    try:
        active_rooms = []
        for room_id, room in rooms.items():
            if room.is_active:
                active_rooms.append({
                    'room_id': room_id,
                    'name': room.name,
                    'message_count': len(room.messages),
                    'clear_interval': room.clear_interval // 60,
                    'time_until_expiry': room.get_time_until_expiry(),
                    'is_default': room_id == "general",
                    'user_count': get_user_count(room_id)
                })
        
        return jsonify({'rooms': active_rooms})
    except Exception as e:
        print(f"Error getting rooms: {e}")
        return jsonify({'error': 'Failed to get rooms'}), 500

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')
    # Get user's room before removing
    user_room = user_rooms.get(request.sid)
    # Remove user from room tracking
    remove_user_from_room(request.sid)
    
    # Notify room about typing status change if user was typing
    if user_room and user_room in typing_users:
        emit('typing_update', {
            'typing_count': get_typing_count(user_room)
        }, room=user_room)

@socketio.on('join_room')
def handle_join_room(data):
    try:
        room_id = data.get('room_id', 'general')
        
        if room_id not in rooms or not rooms[room_id].is_active:
            emit('error', {'message': 'Room not found or inactive'})
            return
        
        join_room(room_id)
        add_user_to_room(request.sid, room_id)
        room = rooms[room_id]
        
        emit('room_joined', {
            'room_id': room_id,
            'room_name': room.name,
            'messages': room.messages,
            'time_until_clear': room.get_time_until_clear(),
            'time_until_expiry': room.get_time_until_expiry(),
            'clear_interval': room.clear_interval // 60,
            'is_default': room_id == "general",
            'user_count': get_user_count(room_id),
            'typing_count': get_typing_count(room_id, exclude_user_id=request.sid)
        })
        
        # Notify others in the room about user count change
        emit('user_count_updated', {
            'room_id': room_id,
            'user_count': get_user_count(room_id)
        }, room=room_id, include_self=False)
        
    except Exception as e:
        print(f"Error joining room: {e}")
        emit('error', {'message': 'Failed to join room'})

@socketio.on('leave_room')
def handle_leave_room(data):
    try:
        room_id = data.get('room_id')
        if room_id:
            leave_room(room_id)
            
            # Check if user was typing before removing
            was_typing = request.sid in typing_users.get(room_id, set())
            remove_user_from_room(request.sid)
            
            # Notify others in the room about user count change
            emit('user_count_updated', {
                'room_id': room_id,
                'user_count': get_user_count(room_id)
            }, room=room_id)
            
            # Update typing status if user was typing
            if was_typing:
                emit('typing_update', {
                    'typing_count': get_typing_count(room_id)
                }, room=room_id)
            
    except Exception as e:
        print(f"Error leaving room: {e}")

@socketio.on('typing_start')
def handle_typing_start(data):
    try:
        room_id = data.get('room_id', 'general')
        
        if room_id in rooms and request.sid in user_rooms and user_rooms[request.sid] == room_id:
            set_user_typing(request.sid, room_id, True)
            
            # Notify others in the room (exclude current user from count)
            emit('typing_update', {
                'typing_count': get_typing_count(room_id, exclude_user_id=request.sid)
            }, room=room_id, include_self=False)
            
    except Exception as e:
        print(f"Error handling typing start: {e}")

@socketio.on('typing_stop')
def handle_typing_stop(data):
    try:
        room_id = data.get('room_id', 'general')
        
        if room_id in rooms and request.sid in user_rooms and user_rooms[request.sid] == room_id:
            set_user_typing(request.sid, room_id, False)
            
            # Notify others in the room (exclude current user from count)
            emit('typing_update', {
                'typing_count': get_typing_count(room_id, exclude_user_id=request.sid)
            }, room=room_id, include_self=False)
            
    except Exception as e:
        print(f"Error handling typing stop: {e}")

@socketio.on('send_message')
def handle_message(data):
    try:
        room_id = data.get('room_id', 'general')
        message = data.get('message', '').strip()
        
        if not message:
            return
        
        if room_id not in rooms or not rooms[room_id].is_active:
            emit('error', {'message': 'Room not available'})
            return
        
        # Stop typing when sending message
        set_user_typing(request.sid, room_id, False)
        
        room = rooms[room_id]
        timestamp = datetime.now().strftime('%H:%M:%S')
        message_data = room.add_message(message, timestamp)
        
        emit('new_message', message_data, room=room_id, include_self=False)
        
        # Update typing status for the room (exclude current user from count)
        emit('typing_update', {
            'typing_count': get_typing_count(room_id, exclude_user_id=request.sid)
        }, room=room_id, include_self=False)
        
    except Exception as e:
        print(f"Error sending message: {e}")

@socketio.on('get_room_status')
def handle_room_status(data):
    try:
        room_id = data.get('room_id', 'general')
        
        if room_id not in rooms:
            return
        
        room = rooms[room_id]
        emit('room_status', {
            'time_until_clear': room.get_time_until_clear(),
            'time_until_expiry': room.get_time_until_expiry(),
            'is_active': room.is_active,
            'user_count': get_user_count(room_id),
            'typing_count': get_typing_count(room_id, exclude_user_id=request.sid)
        })
        
    except Exception as e:
        print(f"Error getting room status: {e}")

if __name__ == '__main__':
    print("Starting Flask-SocketIO server with default room...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)
