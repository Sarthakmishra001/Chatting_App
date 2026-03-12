const Room = require('../models/Room');

const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
};

const requireRoomMember = async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).send('Room not found');

    const isMember = room.members.some(m => m.equals(req.session.userId));
    if (!isMember) {
      return res.status(403).send('Access denied: you are not a member of this room');
    }

    req.room = room;
    next();
  } catch (err) {
    console.error('requireRoomMember error:', err);
    res.status(500).send('Server error');
  }
};

const requireRoomAdmin = (req, res, next) => {
  // MUST be run after requireRoomMember
  if (!req.room.admin.equals(req.session.userId)) {
    return res.status(403).send('Access denied: admin only');
  }
  next();
};

module.exports = { requireAuth, requireRoomMember, requireRoomAdmin };
