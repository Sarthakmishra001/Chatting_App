const User = require('../models/User');

const getSignup = (req, res) => {
  if (req.session.userId) return res.redirect('/lobby');
  res.render('signup', { error: null });
};

const postSignup = async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      const field = existing.email === email.toLowerCase() ? 'Email' : 'Username';
      return res.render('signup', { error: `${field} is already taken.` });
    }

    const user = await User.create({ username: username.trim(), email: email.trim(), password });

    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    return res.redirect('/lobby');

  } catch (err) {
    console.error('Signup error:', err);
    return res.render('signup', { error: 'Signup failed. Please try again.' });
  }
};

const getLogin = (req, res) => {
  if (req.session.userId) return res.redirect('/lobby');
  res.render('login', { error: null });
};

const postLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.render('login', { error: 'No account found with that email.' });

    const match = await user.comparePassword(password);
    if (!match) return res.render('login', { error: 'Incorrect password.' });

    req.session.userId   = user._id.toString();
    req.session.username = user.username;
    return res.redirect('/lobby');

  } catch (err) {
    console.error('Login error:', err);
    return res.render('login', { error: 'Login failed. Please try again.' });
  }
};

const logout = (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
};

module.exports = { getSignup, postSignup, getLogin, postLogin, logout };
