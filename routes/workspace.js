const router = require('express').Router();

const { userController, workspaceController } = require('../controllers');
const workspaceNotificationSettingsController = require('../controllers/workspaceNotificationSettingsController');

const libs = require('../lib');

/*
  Input Body -
      name: String
      type: Number
      courseId: ObjectId(String)  (if type is of course than this field is mandatory)
*/
router.post('/createWorkspace', async (req, res) => {
    try {
        let obj = await workspaceController.createWorkSpace({...req.body, userId: req.session.userId});
        res.json(obj || {});        
    } catch (error) {
      console.log("Error in createWorkspace. Error = ", error);
      res.json({'error': error.message});  
    }
});

/*
  Input Body -
      workSpaceId: UUID(String),
      name: String
*/
router.post('/editWorkspace', async (req, res) => {
  try {
      let obj = await workspaceController.editWorkSpace(req.body);
      res.json(obj || {});        
  } catch (error) {
    console.log("Error in editWorkspace. Error = ", error);
    res.json({'error': error.message});  
  }
});

/*
  Input Body -
      workSpaceId: UUID(String),
*/
router.post('/deleteWorkspace', async (req, res) => {
  try {
      let obj = await workspaceController.deleteWorkSpace({...req.body, userId: req.session.userId});
      res.json(obj || {});        
  } catch (error) {
    console.log("Error in editWorkspace. Error = ", error);
    res.json({'error': error.message});  
  }
});

/*
  Input Body - 
      userId: String,
      workSpaceId: UUID(String),
*/
router.post('/addUserToWorkspace', async (req, res) => {
    try {
        let obj = await workspaceController.addUserToWorkSpace({...req.body, createdBy: req.session.userId});
        res.json(obj || {});        
    } catch (error) {
      console.log("Error in addUserToWorkspace. Error = ", error);
      res.json({'error': error.message});  
    }
});


/*
  Input Body - {}
  Output Body - 
      workspacesArr: [
        {
          id: UUID(String),
          name: String,
        }
      ]
*/
router.post('/list', async (req, res) => {
  try {
      let isAdvanced = ( req.query && req.query.isAdvanced );
      let obj = await workspaceController[isAdvanced ? 'listUserWorkspacesAdvanced' : 'listUserWorkspaces']({...req.body, userId: req.session.userId});
      res.json(obj || {});        
  } catch (error) {
    console.log("Error in listUserWorkspaces. Error = ", error);
    res.json({'error': error.message});  
  }
});

/*
  Input Body - {
    workspaceId: UUID(String),
    notificationSettingsObj: {
      1:{
          unreadMessages:50,
          frequency:10,
          emailNotificationCheck:true,
          smsNotificationCheck:false,
          cqNotificationCheck:true,
      },
      2:{
          unreadMessages:100,
          frequency:86,
          emailNotificationCheck:true,
          smsNotificationCheck:true,
          cqNotificationCheck:true,
      }
    }
  }
*/
router.post('/notificationSettings/update', async (req, res) => {
  try {
      let obj = await workspaceNotificationSettingsController.updateWorkSpaceNotificationSettings({...req.body, userId: req.session.userId});
      res.json(obj || {});
  } catch (error) {
    console.log("Error in update notificationSettings. Error = ", error);
    res.json({'error': error.message});
  }
});

/*
  Input Body - {
    workspaceId: UUID(String)
*/
router.post('/notificationSettings/list', async (req, res) => {
  try {
      let obj = await workspaceNotificationSettingsController.listWorkSpaceNotificationSettings({...req.body, userId: req.session.userId});
      res.json({...obj});
  } catch (error) {
    console.log("Error in list notificationSettings. Error = ", error);
    res.json({'error': error.message});
  }
});


router.post('/invite', async (req, res) => {
  try {
    const {email} = req.body;
    const userObj = await userController.isUserExist({email});
    if (!userObj) throw new Error(libs.messages.errorMessage.userNotFound);
    const userId = userObj.id;
    const result = await workspaceController.addUserToWorkSpace({userId, workspaceId: null, createdBy: req.session.userId});
    return result;
  } catch (error) {
    console.error(error);
    return res.status(500).json({error: error?.message ?? error});
  }
})

module.exports = router;