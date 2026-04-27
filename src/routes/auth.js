const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Registro
router.post('/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;
        
        // Verificar si ya existe
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'El usuario ya existe' });

        user = new User({ firstName, lastName, email, password });
        await user.save();

        res.json({ msg: 'Registro exitoso. Esperando aprobación del administrador.' });
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(400).json({ msg: 'Credenciales inválidas' });
        if (user.status !== 'APPROVED') return res.status(401).json({ msg: 'Usuario no aprobado todavía' });

        const isMatch = await user.comparePassword(password);
        if (!isMatch) return res.status(400).json({ msg: 'Credenciales inválidas' });

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, user: { id: user._id, firstName: user.firstName, role: user.role } });
    } catch (err) {
        res.status(500).send('Error en el servidor');
    }
});

module.exports = router;
