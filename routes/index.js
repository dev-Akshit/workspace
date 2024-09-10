const router = require('express').Router();
const middlewares = require('../middlewares');


router.use('/api', require('./api'));


router.use('/auth', require('./auth'))
router.use('/channel',require('./addUserToChannel'));
router.use('/user', middlewares.session.checkLogin(true),require('./user'));
router.use('/workspace', middlewares.session.checkLogin(true), require('./workspace'));
router.use('/channel', middlewares.session.checkLogin(true), require('./channel'));
router.use('/message', middlewares.session.checkLogin(true), require('./message'));
router.use('/notification', middlewares.session.checkLogin(true), require('./notification'));


module.exports = router;
