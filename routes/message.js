const router = require('express').Router();

const messageController = require('../controllers/messageController');

/*
  Input Body - 
      workspaceId: UUID(String),
      channelId: UUID(String),
      content: String,
*/
router.post('/add', async (req, res) => {
    try {
        req.body.userId = req.session.userId;
        let obj = await messageController.addMessageInRedisStream(req.body);
        res.json(obj || {});        
    } catch (error) {
      console.log("Error in add message. Error = ", error);
      res.json({'error': error.message});
    }
});

/*
  Input Body - 
      messageId: UUID(String),
      content: String,
*/
router.post('/edit', async (req, res) => {
  try {
      req.body.userId = req.session.userId;
      let obj = await messageController.editMessage(req.body);
      res.json(obj || {});        
  } catch (error) {
    console.log("Error in edit message. Error = ", error);
    res.json({'error': error.message});
  }
});

/*
  Input Body - 
      workspaceId: UUID(String),
      channelId: UUID(String),
      messageId: UUID(String),
*/
router.post('/delete', async (req, res) => {
    try {
        req.body.userId = req.session.userId;
        let obj = await messageController.deleteMessage(req.body);
        res.json(obj || {});        
    } catch (error) {
      console.log("Error in delete message. Error = ", error);
      res.json({'error': error.message});
    }
});

/*
  Input Body -
      workspaceId: UUID(String),
      channelId: UUID(String),
      lastRead: Number (OPTIONAL),
      limit: Number (OPTIONAL),
      isPrevious: 1 or 0,
      messageId: UUID(String) (OPTIONAL),
      includeLastSeen: Bool (OPTIONAL),
*/
router.post('/list', async (req, res) => {
  try {
      req.body.userId = req.session.userId;
      const isBothSide = req.query && req.query.isBothSide;
      let obj;
      if ( isBothSide)  obj = await messageController.listMessagesBothSide(req.body);
      else              obj = await messageController.listMessages(req.body);
      res.json(obj || {});
  } catch (error) {
    console.log("Error in list message. Error = ", error);
    res.json({'error': error.message});
  }
});

/*
  Input Body - 
      workspaceId: UUID(String),
      channelId: UUID(String),
      parentIdOfReply: UUID(String),
      content: String,
*/
router.post('/reply/add', async (req, res) => {
  try {
      req.body.userId = req.session.userId;
      let obj = await messageController.addReply(req.body);
      res.json(obj || {});        
  } catch (error) {
    console.log("Error in add reply. Error = ", error);
    res.json({'error': error.message});
  }
});

/*
Input Body - 
    messageId: UUID(String),
    content: String,
*/
router.post('/reply/edit', async (req, res) => {
try {
    req.body.userId = req.session.userId;
    let obj = await messageController.editReply(req.body);
    res.json(obj || {});        
} catch (error) {
  console.log("Error in edit reply. Error = ", error);
  res.json({'error': error.message});
}
});

/*
Input Body - 
    messageId: UUID(String),
*/
router.post('/reply/delete', async (req, res) => {
  try {
      req.body.userId = req.session.userId;
      let obj = await messageController.deleteReply(req.body);
      res.json(obj || {});        
  } catch (error) {
    console.log("Error in delete reply. Error = ", error);
    res.json({'error': error.message});
  }
});

/*
  Input Body -
      workspaceId: UUID(String),
      channelId: UUID(String),
      parentIdOfReply: UUID(String),
*/
router.post('/reply/list', async (req, res) => {
  try {
      req.body.userId = req.session.userId;
      let obj = await messageController.listReplies(req.body);
      res.json(obj || {});
  } catch (error) {
    console.log("Error in reply list. Error = ", error);
    res.json({'error': error.message});
  }
});

router.get('/streamsLength', async (req, res) => {
  try {
      req.body.userId = req.session.userId;
      let obj = await messageController.getMessageStreamsLengthOfAllChannels();
      res.json(obj || {});
  } catch (error) {
    console.log("Error in streamsLength. Error = ", error);
    res.json({'error': error.message});
  }
});

module.exports = router;