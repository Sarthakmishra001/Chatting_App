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

const PORT = process.env.PORT || 3000;
connectDB();

const FIXED_PASSWORD = process.env.FIXED_PASSWORD;

const SESSION_SECRET = process.env.SESSION_SECRET || 'FIXED_PASSWORD'; 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');

app.use(session({
    secret: 'FIXED_PASSWORD', 
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' } 
}));

let users = {};

app.get('/', (req, res) => {
    res.redirect('/signup');
});

app.get('/signup', (req, res) => {
    res.render('signup');
});

app.post('/signup', (req, res) => {
    const { username, password } = req.body;

    if (password === FIXED_PASSWORD) {
        req.session.user = username; 
        users[username] = username;
        res.redirect(`/chat?user=${username}`);
    } else {
        res.render('signup', { error: 'Password is incorrect. Please try again.' });
    }
});

app.get('/chat', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/signup');
    }
    const currentUser = req.session.user;
    const messages = await Message.find().sort({ timestamp: 1 });
    res.render('chat', { messages, currentUser });
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
        await newMessage.save(); 

        io.emit('messageBroadcast', data);
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', data);
    });

    socket.on('stopTyping', () => {
        socket.broadcast.emit('stopTyping');
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
