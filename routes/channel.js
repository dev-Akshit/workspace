const router = require('express').Router();
const utils = require('../lib/utils');
const channelController = require('../controllers/channelController');
const { userController } = require('../controllers');

/*
  Input Body - 
      name: String,
      workspaceId: UUID(String),
      type: constants.channelTypes(Number)
*/
router.post('/createChannel', async (req, res) => {
    try {
        let obj = await channelController.createChannel({...req.body, userId: req.session.userId});
        res.json(obj || {});        
    } catch (error) {
      console.log("Error in createChannel. Error = ", error);
      res.json({'error': error.message});  
    }
});

/*
  Input Body - 
      userId: String,
      workspaceId: UUID(String),
      channelId: UUID(String),
*/
router.post('/addUserToChannel', async (req, res) => {
    try {
				req.body = {
					...req.body,
					createdBy: req.session.userId,
					userId: req.body.userIdToAdd,
				}
        let obj = await channelController.addUserToChannel(req.body);
        res.json(obj || {});        
    } catch (error) {
      console.log("Error in addUserToChannel. Error = ", error);
      res.json({'error': error.message});  
    }
});

/*
  Input Body - 
      workspaceId: UUID(String),
      channelId: UUID(String),
      batchId: ObjectId(String),
*/
router.post('/addBatchToChannel', async (req, res) => {
  try {
      let obj = await channelController.addBatchToChannel({ ...req.body, createdBy: req.session.userId });
      res.json(obj || {});
  } catch (error) {
      console.log("Error in addBatchToChannel. Error = ", error);
      res.json({ 'error': error.message });
  }
});

/*
  Input Body - 
    workspaceId: UUID(String),
  
  Output Body - 
    channelsArr: [
      {
        id: UUID(String),
        name: String
      }
    ]
*/
router.post('/list', async (req, res) => {
  try {
      let obj = await channelController.listChannels({...req.body, userId: req.session.userId});
      res.json(obj || {});        
  } catch (error) {
    console.log("Error in list channels. Error = ", error);
    res.json({'error': error.message});  
  }
});

/*
  Input Body - 
      workspaceId: UUID(String),
      channelId: UUID(String),
*/
router.post('/setLastSeen', async (req, res) => {
  try {
      let obj = await channelController.setLastSeenOfChannel({...req.body, userId: req.session.userId});
      res.json(obj || {});        
  } catch (error) {
    console.log("Error in setLastSeen. Error = ", error);
    res.json({'error': error.message});  
  }
});

/*
  Input Body - 
      workspaceId: UUID(String),
      channelId: UUID(String),
      lastRead: TimeStamp(Number)
*/
router.post('/setLastRead', async (req, res) => {
  try {
      let obj = await channelController.setLastReadOfChannel({...req.body, userId: req.session.userId});
      res.json(obj || {});        
  } catch (error) {
    console.log("Error in setLastRead. Error = ", error);
    res.json({'error': error.message});  
  }
});


/*
  Input Body - 
      channelId: UUID(String),
      updatedChannelName: String
*/
router.post('/updateName', async (req,res) => {
  try {
    let obj = await channelController.editChannelName({...req.body});
    res.json(obj || {});
  } catch (error) {
    console.log("Error in edit channel name = ",error);
    res.json({'error':error.message});
  }
})

/*
  Input Body - 
      channelId: UUID(String),
      permissionValue: Number
*/
router.post('/setChannelWritePermission', async (req,res) => {
  try {
    let obj = await channelController.setChannelWritePermissionValue({...req.body});
    res.json(obj || {});
  } catch (error) {
    console.log("Error in setChannelWritePermission = ",error);
    res.json({'error':error.message});
  }
})

router.post('/getOnlineUsersListInChannel', async (req,res) => {
  try {
    const {channelId} = req.body;
    if ( ! channelId )  throw new Error("ChannelId is null");
    let userIdsSet = await utils.getOnlineUserIdsSetInChannelRoom(channelId);
    res.json({userIds: [...userIdsSet]});
  } catch (error) {
    console.log("Error in getOnlineUsersListInChannel = ",error);
    res.json({'error':error.message});
  }
})

router.get('/getChannelDetail/:channelId', async (req,res) => {
  try {
    const channelId = req.params && req.params.channelId;
    if ( ! channelId )  throw new Error("ChannelId is null");
    let channelObj = await channelController.getOneChannel(channelId);
    res.json({channelObj});
  } catch (error) {
    console.log("Error in getOnlineUsersListInChannel = ",error);
    res.json({'error':error.message});
  }
})

module.exports = router;
