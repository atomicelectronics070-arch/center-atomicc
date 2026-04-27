const express = require('express');
const router = express.Router();
const User = require('../models/User');
// const { auth, adminAuth } = require('../middleware/auth'); // Middleware to be created

// Obtener todos los usuarios pendientes
router.get('/users/pending', async (req, res) => {
    try {
        const users = await User.find({ status: 'PENDING' });
        res.json(users);
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
});

// Aprobar/Rechazar usuario
router.post('/users/approve', async (req, res) => {
    try {
        const { userId, status } = req.body; // status: 'APPROVED' or 'REJECTED'
        const user = await User.findByIdAndUpdate(userId, { status }, { new: true });
        res.json({ msg: `Usuario ${user.firstName} ${status}` });
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
});

// Obtener galería (placeholder por ahora)
router.get('/gallery', async (req, res) => {
    // Aquí iría la lógica para buscar archivos en MongoDB/GridFS o Cloudinary
    res.json({ msg: 'Galería multimedia global (próximamente)' });
});

module.exports = router;
