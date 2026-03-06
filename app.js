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

const PORT = process.env.PORT || 3001;
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

app.get('/', (req, res) => res.redirect('/signup'));

app.get('/signup', (req, res) => res.render('signup'));

app.post('/signup', (req, res) => {
  const { username, password } = req.body;

  if (password === FIXED_PASSWORD) {
    req.session.user = username;
    users[username] = username;
    res.redirect(`/chat?user=${username}`);
  } else {
    res.render('signup', { error: 'Password is incorrect.' });
  }
});

app.get('/chat', async (req, res) => {
  if (!req.session.user) return res.redirect('/signup');

  const messages = await Message.find().sort({ timestamp: 1 });
  res.render('chat', { messages, username: req.session.user });
});

/* ================= SOCKET ================= */

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('newMessage', async (data) => {
    const newMessage = new Message({
      sender: data.sender,
      text: data.text
    });

    await newMessage.save();
    io.emit('messageBroadcast', data);
  });

  socket.on('deleteForMe', async (messageId, username) => {
    try {
      const message = await Message.findById(messageId);

      if (message && message.sender === username) {
        await Message.deleteOne({ _id: messageId });
        io.emit('messageDeletedForMe', { messageId, username });
      }
    } catch (err) {
      console.log("Delete for me error:", err);
    }
  });

  socket.on('deleteForEveryone', async (messageId) => {
    try {
      await Message.deleteOne({ _id: messageId });
      io.emit('messageDeletedForEveryone', { messageId });
    } catch (err) {
      console.log("Delete for everyone error:", err);
    }
  });

  socket.on('typing', (data) => {
    socket.broadcast.emit('displayTyping', data);
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
  socket.on('video-answer', ({ to, answer }) => {
    const targetSocketId = socketUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('video-answer', { answer });
    }
  });

  // Relay ICE candidates between peers
  socket.on('ice-candidate', ({ to, candidate }) => {
    const targetSocketId = socketUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', { candidate });
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
        console.log(`Removed from socketUsers: ${username}`);
        break;
      }
    }
    console.log('A user disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
