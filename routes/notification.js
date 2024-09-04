const router = require('express').Router();

const notificationController = require('../controllers/notificationController');

/*
  Input Body -
      
*/
router.get('/list', async (req, res) => {
  try {
      req.body.userId = req.session.userId;
      let obj = await notificationController.listNotifications(req.body);
      res.json(obj || {});
  } catch (error) {
    console.log("Error in list notifications. Error = ", error);
    res.json({'error': error.message});
  }
});


module.exports = router;
