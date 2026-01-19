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
const SESSION_SECRET = process.env.SESSION_SECRET || 'FIXED_PASSWORD';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

let users = {};

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

function validatePassword(req, res, next) {
    if (!req.session.user || req.body.password !== FIXED_PASSWORD) {
        return res.redirect('/signup');
    }
    next();
}

app.use('/chat', validatePassword);

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('newMessage', async (data) => {
        const newMessage = new Message({ sender: data.sender, text: data.text });
        await newMessage.save(); // Save to DB
        io.emit('messageBroadcast', data); // Emit message to all users
    });

    // Handle "Delete for Me" action
    socket.on('deleteForMe', async (messageId, username) => {
        try {
            const message = await Message.findById(messageId);
            if (message && message.sender === username) {
                await Message.deleteOne({ _id: messageId }); // Remove from DB
                io.emit('messageDeletedForMe', { messageId, username });
            }
        } catch (error) {
            console.error("Error deleting message:", error);
        }
    });

    // Handle "Delete for Everyone" action
    socket.on('deleteForEveryone', async (messageId) => {
        try {
            await Message.deleteOne({ _id: messageId }); // Remove from DB
            io.emit('messageDeletedForEveryone', { messageId });
        } catch (error) {
            console.error("Error deleting message:", error);
        }
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('displayTyping', data);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
