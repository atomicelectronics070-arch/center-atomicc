const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    accountId: { type: String, required: true },
    chatId: { type: String, required: true },
    from: { type: String, required: true },
    body: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    type: { type: String, enum: ['incoming', 'outgoing'], default: 'incoming' },
    aiSuggestion: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
});

module.exports = mongoose.model('Message', MessageSchema);
