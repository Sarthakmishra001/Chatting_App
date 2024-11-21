const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: String,
    text: String,
    timestamp: {
        type: Date,
        default: Date.now,
    },
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
