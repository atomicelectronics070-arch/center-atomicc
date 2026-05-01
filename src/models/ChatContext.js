const mongoose = require('mongoose');

const ChatContextSchema = new mongoose.Schema({
    accountId: { type: String, required: true },
    chatId: { type: String, required: true },
    summary: { type: String, default: "Aún no hay suficiente contexto resumido de esta conversación." },
    lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ChatContext', ChatContextSchema);
