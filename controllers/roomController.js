const Room = require('../models/Room');
const Message = require('../models/message');

const getLobby = async (req, res) => {
  try {
    const rooms = await Room.find()
      .populate('admin', 'username')
      .populate('members', '_id')
      .populate('joinRequests', 'username _id')
      .lean();

    const userId = req.session.userId;

    const annotated = rooms.map(room => ({
      ...room,
      isMember : room.members.some(m => m._id.toString() === userId),
      isPending : room.joinRequests.some(r => r._id.toString() === userId),
      isAdmin   : room.admin._id.toString() === userId,
    }));

    res.render('lobby', {
      rooms: annotated,
      username: req.session.username,
      userId,
      query: req.query
    });
  } catch (err) {
    console.error('getLobby error:', err);
    res.status(500).send('Server error');
  }
};

const createRoom = async (req, res) => {
  const { name } = req.body;
  const userId = req.session.userId;

  if (!name || !name.trim()) return res.redirect('/lobby?error=Room+name+required');

  try {
    const existing = await Room.findOne({ name: name.trim() });
    if (existing) return res.redirect('/lobby?error=Room+name+already+taken');

    await Room.create({
      name: name.trim(),
      admin: userId,
      members: [userId],
    });
    res.redirect('/lobby');
  } catch (err) {
    console.error('createRoom error:', err);
    res.redirect('/lobby?error=Failed+to+create+room');
  }
};

const requestJoin = async (req, res) => {
  const userId = req.session.userId;
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).send('Room not found');

    const alreadyMember  = room.members.some(m => m.equals(userId));
    const alreadyPending = room.joinRequests.some(r => r.equals(userId));

    if (alreadyMember)  return res.redirect('/lobby?error=Already+a+member');
    if (alreadyPending) return res.redirect('/lobby?error=Request+already+sent');

    room.joinRequests.push(userId);
    await room.save();
    res.redirect('/lobby');
  } catch (err) {
    console.error('requestJoin error:', err);
    res.redirect('/lobby?error=Failed+to+send+request');
  }
};

const approveJoin = async (req, res) => {
  const { requestUserId } = req.body;
  try {
    const room = req.room; 
    room.joinRequests = room.joinRequests.filter(r => !r.equals(requestUserId));
    if (!room.members.some(m => m.equals(requestUserId))) {
      room.members.push(requestUserId);
    }
    await room.save();
    res.redirect('/lobby');
  } catch (err) {
    console.error('approveJoin error:', err);
    res.redirect('/lobby?error=Approval+failed');
  }
};

const rejectJoin = async (req, res) => {
  const { requestUserId } = req.body;
  try {
    const room = req.room;
    room.joinRequests = room.joinRequests.filter(r => !r.equals(requestUserId));
    await room.save();
    res.redirect('/lobby');
  } catch (err) {
    console.error('rejectJoin error:', err);
    res.redirect('/lobby?error=Rejection+failed');
  }
};

const getChat = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate('members', 'username _id')
      .populate('admin', '_id')
      .lean();

    const messages = await Message.find({ 
      roomId: req.params.id,
      deletedFor: { $ne: req.session.userId }
    })
      .sort({ createdAt: 1 })
      .lean();

    res.render('chat', {
      room,
      messages,
      username : req.session.username,
      userId   : req.session.userId,
    });
  } catch (err) {
    console.error('getChat error:', err);
    res.status(500).send('Server error');
  }
};

module.exports = { getLobby, createRoom, requestJoin, approveJoin, rejectJoin, getChat };
