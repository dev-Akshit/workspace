const router = require('express').Router();
const utils = require('../lib/utils');
const channelController = require('../controllers/channelController');
const { userController } = require('../controllers');
const jwtToken = require("../utils/jwtToken");
const emailService = require('../services/emailService');
const libs = require('../lib');

/*
  Input Body - 
      name: String,
      workspaceId: UUID(String),
      type: constants.channelTypes(Number)
*/
router.post('/createChannel', async (req, res) => {
    try {
        const {name} = req.body;
        if (name && !libs.regex.channelRegex.test(name) ) {
          throw new Error("Channel name is not valid");
        }
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
    console.log("invite to channel", req.body);
    let data={
      email : req.body.userEmail,
      workspaceId : req.body.workspaceId,
      channelId : req.body.channelId,
      createdBy: req.session.userId,
    }
    if(!data.email || !data.workspaceId || !data.channelId){
      throw new Error("Incomplete data to Add user to channel")
    }
    const invitedUserData = await userController.isUserExist({email: data.email});
    if(invitedUserData){
      data = {...data, userIdToAdd: invitedUserData.id};
      const token = await jwtToken.generateToken(data, process.env.JWT_SECRET);
      const emailInstance = emailService.CreateEmailFactory(
        {
          email: req.body.userEmail,
          userIdToAdd: invitedUserData.id, 
          workspaceId : req.body.workspaceId,
          channelId : req.body.channelId,  
          Type: libs.constants.emailType.ChannelInvite, 
          token: token
        } , invitedUserData );
        await emailInstance.sendEmail();

        res.json({msg: "Invite successfully"} || {});        
    } else {
      const token = await jwtToken.generateToken(data, process.env.JWT_SECRET);
      const emailInstance = emailService.CreateEmailFactory(
        {
          email: req.body.userEmail,
          workspaceId : req.body.workspaceId,
          channelId : req.body.channelId,  
          Type: libs.constants.emailType.UserAndChannelInvite, 
          token: token
        } , data );
      await emailInstance.sendEmail();

      res.json({msg: "Refer successfully"} || {});
    }
  } catch (error) {
    console.log("Error in inviteToChannel. Error = ", error);
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
    const { updatedChannelName } = req.body;
    if (!updatedChannelName || !libs.regex.channelRegex.test(updatedChannelName)) {
      throw new Error('Channel Name is not valid');
    }
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


router.get('/leaveChannel/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    await channelController.removeCurrentUserFromChannel(req.session, channelId);
    return res.json({message: 'Success'});
  } catch (error) {
    console.log("Error while leaving Channel = ", error);
    return res.json({'error': error.message});
  }
});

module.exports = router;
