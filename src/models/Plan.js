const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
    title: { type: String, default: 'Plan Mensual Matriz' },
    content: { type: String, required: true },
    month: { type: String, required: true }, // e.g., "2026-04"
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Plan', PlanSchema);
