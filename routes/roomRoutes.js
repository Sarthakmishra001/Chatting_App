const express = require('express');
const router = express.Router();

const { requireAuth, requireRoomMember, requireRoomAdmin } = require('../middleware/auth');
const { getLobby, createRoom, requestJoin, approveJoin, rejectJoin, getChat } = require('../controllers/roomController');

router.get('/lobby', requireAuth, getLobby);

router.post('/rooms/create', requireAuth, createRoom);

router.post('/rooms/:id/request', requireAuth, requestJoin);

router.post('/rooms/:id/approve', requireAuth, requireRoomMember, requireRoomAdmin, approveJoin);
router.post('/rooms/:id/reject', requireAuth, requireRoomMember, requireRoomAdmin, rejectJoin);

router.get('/rooms/:id/chat', requireAuth, requireRoomMember, getChat);

module.exports = router;
