const mongoose = require('mongoose');

const SystemContextSchema = new mongoose.Schema({
    accountId: { type: String, required: true },
    globalSummary: { type: String, default: "El centro de ventas está activo. Esperando interacciones iniciales para construir contexto global." },
    lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SystemContext', SystemContextSchema);
