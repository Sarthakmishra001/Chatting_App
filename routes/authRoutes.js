const express = require('express');
const router = express.Router();
const { getSignup, postSignup, getLogin, postLogin, logout } = require('../controllers/authController');

router.get('/signup', getSignup);
router.post('/signup', postSignup);

router.get('/login', getLogin);
router.post('/login', postLogin);

router.get('/logout', logout);

module.exports = router;
