const router = require('express').Router();
const validator = require('validator');

const libs = require('../lib');
const userController = require('../controllers/userController');
const userActivityController = require('../controllers/userActivityController');

/*
  Input Body - 
      userIds: [String],
      workSpaceId: UUID(String),   OPTIONAL
      channelId: UUID(String),     OPTIONAL
*/
router.post('/addUsers', async (req, res) => {
    try {
        req.body.createdBy = req.session.userId;
        let obj = await userController.addUsers(req.body);
        res.json(obj || {});        
    } catch (error) {
      console.log("Error in addUser. Error = ", error);
      res.json({'error': error.message});  
    }
});

/*
  Input Body - 
      userIds: [String],
      workSpaceId: UUID(String),   OPTIONAL
      channelId: UUID(String),     OPTIONAL
*/
// router.post('/addMultipleUsers', async (req, res) => {
//   try {
//       req.body.createdBy = req.session.userId;
//       let obj = await userController.addMultipleUsers(req.body);
//       res.json(obj || {});        
//   } catch (error) {
//     console.log("Error in addMultipleUsers. Error = ", error);
//     res.json({'error': error.message});  
//   }
// });

/*
  Input Body -
      workspaceId: UUID(String),
      channelId: UUID(String),
      lastRead: Number (OPTIONAL),
      limit: Number (OPTIONAL),
      isPrevious: 1 or 0,
      includeLastSeen: Bool (OPTIONAL),
*/
router.post('/userActivityList', async (req, res) => {
  try {
      req.body.userId = req.session.userId;
      let obj = await userActivityController.listUserActivities(req.body);
      res.json(obj || {});
  } catch (error) {
    console.log("Error in userActivityList. Error = ", error);
    res.json({'error': error.message});
  }
});

/*
  Input Body -
      channelId: UUID(String),
      prefix: String,
*/
router.post('/getUsersList', async (req, res) => {
  try {
    req.body.userId = req.session.userId;
    let usersData = await userController.getChannelUsersData(req.body);
    res.json({usersData});
  } catch (error) {
    console.log("Error in getUsersList = ",error);
    res.json({'error':error.message});
  }
})

router.post('/getUsersData', async (req, res) => {
  try {
    const {prefix} = req.body;
    const userData = await userController.isUserExist({email: prefix});
    if (!userData) throw new Error(libs.messages.errorMessage.userNotFound);
    return res.json({usersData: [{_id: userData.id, email: userData.email}]});
  } catch (error) {
    console.log("Error in getttinguserData", error);
    return res.status(500).json({error: error?.message ?? error})
  }
})

router.post('/updateProfile', async (req, res) => {
  try {
    const objToUpdate = {};
    if (req.body.profilePic) {
      if (!validator.isURL(req.body.profilePic, { 
        allow_trailing_dot: true,
        allow_fragments: true,
        allow_localhost: true,
        
      })) {
        if (process.env.NODE_ENV !== "local" && req.body.profilePic.startsWith('http://localhost')) {
          throw new Error(`Profile Picture `+ libs.messages.errorMessage.urlNotValid);
        }
      }  
      objToUpdate.profilePic = req.body.profilePic;
    } else {
      objToUpdate.profilePic = null;
    }
    if (req.body.username) {
      if (!libs.regex.name.test(req.body.username)) throw new Error(libs.messages.errorMessage.userNameNotValid)
      objToUpdate.username = req.body.username;
    }
    if (req.body.password) {
      if (!libs.regex.password.test(req.body.password)) throw new Error(libs.messages.errorMessage.passwordIsNotValid)
      if (!req.body.oldPassword) {
        throw new Error(libs.messages.errorMessage.passwordIsNotValid);
      }
      const isOldPasswordCorrect = await userController.validateUserPassword(req.session.userId, req.body.oldPassword);
      if (!isOldPasswordCorrect) {
        throw new Error(libs.messages.errorMessage.confirmPasswordIsNotValid);
      }
      objToUpdate.password =  await libs.utils.encryptString(req.body.password);
    }
    await userController.updateUserProfile(req.session.userId, objToUpdate);
    if (objToUpdate.username) {
      req.session.displayname = objToUpdate.username;
    }
    req.session.profilePic = objToUpdate.profilePic;
    return res.json({status: libs.constants.statusToNumber.success});
  } catch (error) {
    console.log("Error while updateing user profile", error);
    return res.json({error: error?.message ?? error});
  }
})

module.exports = router;