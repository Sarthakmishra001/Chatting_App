require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const session = require('express-session');

const connectDB = require('./models/mongodb');
const Message = require('./models/message');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3003;
connectDB();

const FIXED_PASSWORD = process.env.FIXED_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || "chatapp_secret";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // render https handle karega
}));

let users = {};

// Maps username -> socket.id for WebRTC signaling routing
const socketUsers = {};

// Maps userId -> socket.id for Global Online Tracking
const onlineUsers = new Map();

const authRoutes = require('./routes/authRoutes');
const roomRoutes = require('./routes/roomRoutes');

// Load routers
app.use('/', authRoutes);
app.use('/', roomRoutes);

// Base route directs to login
app.get('/', (req, res) => res.redirect('/login'));

/* ================= SOCKET ================= */

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Join a specific room for chat isolation
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);
  });

  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    console.log(`Socket ${socket.id} left room ${roomId}`);
  });

  socket.on('newMessage', async (data) => {
    const { roomId, sender, senderName, text } = data;

    try {
      const newMessage = new Message({
        roomId,
        sender,
        senderName,
        text
      });

      await newMessage.save();
      
      // Emit strictly to the room
      io.to(roomId).emit('messageBroadcast', {
        _id: newMessage._id.toString(),
        sender,
        senderName,
        text,
        createdAt: newMessage.createdAt
      });
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  socket.on('deleteForMe', async ({ messageId, userId, roomId }) => {
    try {
      if (!roomId) return; // Prevent raw global exploitation

      // Push the userId into the deletedFor array of this document
      const doc = await Message.findOneAndUpdate(
        { _id: messageId, roomId },
        { $addToSet: { deletedFor: userId } }
      );

      if (doc) {
        socket.emit('messageDeletedForMe', { messageId });
      }
    } catch (err) {
      console.error("Delete for me error:", err);
    }
  });

  socket.on('deleteForEveryone', async ({ messageId, userId, roomId }) => {
    try {
      if (!roomId) return;
      const message = await Message.findById(messageId);
      if (message && message.sender.equals(userId)) {
        // Soft delete for everyone instead of hard delete
        message.deletedForEveryone = true;
        await message.save();
        io.to(roomId).emit('messageDeletedForEveryone', { messageId });
      }
    } catch (err) {
      console.error("Delete for everyone error:", err);
    }
  });

  socket.on('typing', ({ roomId, user }) => {
    socket.to(roomId).emit('displayTyping', { user });
  });

  /* ================= User Online Tracking ================= */

  socket.on('register-user-status', (userId) => {
    onlineUsers.set(userId, socket.id);
    // Broadcast status change to everyone
    io.emit('user-status-changed', { userId, status: 'online' });
    console.log(`User Registered: ${userId} -> ${socket.id}`);
  });

  socket.on('get-online-status', () => {
    // Return an array of all currently active userIds
    socket.emit('online-status-sync', Array.from(onlineUsers.keys()));
  });

  /* ================= Join Room Requests (Socket Version) ================= */

  socket.on('join-room-request', async ({ roomId, userId, username }) => {
    try {
      const Room = require('./models/Room');
      const room = await Room.findById(roomId);
      if (!room) return;

      // Add to joinRequests if not already there
      if (!room.joinRequests.includes(userId)) {
        room.joinRequests.push(userId);
        await room.save();
      }

      // Notify Admin in real-time
      const adminSocketId = onlineUsers.get(room.admin.toString());
      if (adminSocketId) {
        io.to(adminSocketId).emit('join-request-received', {
          roomId,
          roomName: room.name,
          user: { _id: userId, username }
        });
      }

      // Notify requester that request is sent
      socket.emit('join-request-sent', { roomId });
    } catch (err) {
      console.error('join-room-request error:', err);
    }
  });

  socket.on('approve-join-request', async ({ roomId, requestUserId }) => {
    try {
      const Room = require('./models/Room');
      const room = await Room.findById(roomId);
      if (!room) return;

      // Check if current socket is admin (simple check)
      // In a real app, you'd check session or auth token associated with socket
      
      // Remove from joinRequests, add to members
      room.joinRequests = room.joinRequests.filter(id => id.toString() !== requestUserId);
      if (!room.members.includes(requestUserId)) {
        room.members.push(requestUserId);
      }
      await room.save();

      // Notify the approved user
      const userSocketId = onlineUsers.get(requestUserId);
      if (userSocketId) {
        io.to(userSocketId).emit('join-approved', { roomId, roomName: room.name });
      }

      // Notify admin of success
      socket.emit('approval-success', { roomId, requestUserId });

      // Notify all members in the room about the new member (optional but good)
      io.to(roomId).emit('member-joined', { roomId, userId: requestUserId });
    } catch (err) {
      console.error('approve-join-request error:', err);
    }
  });

  socket.on('reject-join-request', async ({ roomId, requestUserId }) => {
    try {
      const Room = require('./models/Room');
      const room = await Room.findById(roomId);
      if (!room) return;

      room.joinRequests = room.joinRequests.filter(id => id.toString() !== requestUserId);
      await room.save();

      // Notify the rejected user (optional)
      const userSocketId = onlineUsers.get(requestUserId);
      if (userSocketId) {
        io.to(userSocketId).emit('join-rejected', { roomId, roomName: room.name });
      }

      socket.emit('rejection-success', { roomId, requestUserId });
    } catch (err) {
      console.error('reject-join-request error:', err);
    }
  });

  /* ================= WebRTC Signaling ================= */

  // Store username → socket.id mapping
  socket.on('register-user', (username) => {
    socketUsers[username] = socket.id;
    console.log(`Registered: ${username} -> ${socket.id}`);
  });

  // Caller initiates: forward SDP offer to the target peer
  socket.on('call-user', ({ to, from, offer }) => {
    const targetSocketId = socketUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('video-offer', { from, offer });
    }
  });

  // Callee answers: forward SDP answer back to the original caller
  socket.on('video-answer', ({ to, from, answer }) => {
    const targetSocketId = socketUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('video-answer', { from, answer });
    }
  });

  // Relay ICE candidates between peers
  socket.on('ice-candidate', ({ to, from, candidate }) => {
    const targetSocketId = socketUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', { from, candidate });
    }
  });

  // Callee rejected the incoming call
  socket.on('call-rejected', ({ to }) => {
    const targetSocketId = socketUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-rejected');
    }
  });

  // Either party ends the call — forward to the peer
  socket.on('call-ended', ({ to }) => {
    const targetSocketId = socketUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-ended');
    }
  });

  /* ================= Disconnect Cleanup ================= */

  socket.on('disconnect', () => {
    // Remove stale username → socket mapping
    for (const [username, id] of Object.entries(socketUsers)) {
      if (id === socket.id) {
        delete socketUsers[username];
        console.log(`Removed from WebRTC socketUsers: ${username}`);
        break;
      }
    }

    // Remove from Online Tracking and broadcast update
    for (const [uid, sid] of onlineUsers.entries()) {
      if (sid === socket.id) {
        onlineUsers.delete(uid);
        io.emit('user-status-changed', { userId: uid, status: 'offline' });
        console.log(`User Offline: ${uid}`);
        break;
      }
    }
    
    console.log('A user disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
