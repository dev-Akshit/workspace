const middlewares = require('../../middlewares');

const router = require('express').Router();

router.get('/getLimitedSessionData' , middlewares.session.checkLogin(true),(req,res) => {
    try {
        const session = req.session;
        if (!session) throw new Error('Session Not Present');
        return res.json({session});
    } catch (error) {
        console.log(error);
        return res.status(401).json({error: error?.message ?? error})
    }
})

module.exports = router