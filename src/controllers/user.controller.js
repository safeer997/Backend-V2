import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccessAndRefreshToken = async (userId) => {
  try {
    const user = await User.findById(userId);

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    //add refreh token to db and save

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(500, "problem while generating tokens");
  }
};

const registerUser = asyncHandler(async (req, res) => {
  //get user details from frontend
  //validation - at least not empty
  //check if user already exist - by username and email
  //check for images : check for avatar, uploaded by multer or not
  //upoad them to cloudinary : check for avatr whtere uploaded or not
  //create user object - create entry in db
  //check for user creation
  //remove password and refresh token from from response
  //return response

  //step 1
  const { fullName, username, email, password } = req.body;

  //step 2

  // if (fullName==="") {
  //   throw new ApiError (400,"Fullname is required !")

  // }

  if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All Field are required");
  }

  //step 3

  const existedUser = await User.findOne({
    $or: [{ email }, { username }],
  });

  if (existedUser) {
    throw new ApiError(409, "User with email or username already existed");
  }

  //step 4
  //multer gives access to req.files just like we get req.body by express

  const avatarLocalPath = req.files?.avatar[0]?.path;

  const coverImageLocalPath = req.files?.coverImage[0]?.path;

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required ");
  }

  //step 5

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!avatar) {
    throw new ApiError(400, "Avatar file is required ");
  }

  //step 6

  const user = await User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowerCase(),
  });

  //step 7-8
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new ApiError(500, "something went wrong while registering the user");
  }

  //step 9
  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "user registered successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  //get data from req body
  //username or email
  //find the user in database
  //password check
  //generate access and refresh token
  //send tokens via cookies (secure cookies)

  const { username, email, password } = req.body;

  if (!(username || email)) {
    throw new ApiError(400, "username or password is required");
  }

  const user = await User.findOne({
    $or: [{ email }, { username }],
  });

  if (!user) {
    throw new ApiError(404, "user not found");
  }

  const checkPassword = await user.isPasswordCorrect(password);

  if (!checkPassword) {
    throw new ApiError(404, "password not correct");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
    user._id
  );

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "user logged in successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        refreshToken: undefined,
      },
    },
    {
      new: true,
    }
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, "user logged out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies?.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized access ");
  }
  try {
    const decodedRefreshToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    const user = await User.findById(decodedRefreshToken?._id);

    if (!user) {
      throw new ApiError(400, "Invalid refresh token");
    }

    if (user.refreshToken !== incomingRefreshToken) {
      throw new ApiError(400, " refresh tokens is expired or used");
    }

    const { updatedAccessToken, updatedRefreshToken } =
      await generateAccessAndRefreshToken(user._id);

    await User.findByIdAndUpdate(
      decodedRefreshToken._id,
      {
        $set: {
          refreshToken: updatedRefreshToken,
        },
      },
      {
        new: true,
      }
    );

    const options = {
      httpOnly: true,
      secure: true,
    };

    return res
      .status(200)
      .cookie("accessToken", updatedAccessToken, options)
      .cookie("refreshToken", updatedRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          {
            accessToken: updatedAccessToken,
            refreshToken: updatedRefreshToken,
          },
          "tokens updated successfully"
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token");
  }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id);

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

  if (!isPasswordCorrect) {
    throw new ApiError(400, "invalid password");
  }

  user.password = newPassword;
  //here we have just chnaged the password value in next line we are saving it.

  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed Successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "current user fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  const { email, fullName } = req.body;

  if (!(fullName || email)) {
    throw new ApiError(400, "fullname and email required");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        email: email,
        fullName,
      },
    },
    {
      new: true,
    }
  ).select("-password -refreshToken");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated Successfully"));
});

const updateAvatar = asyncHandler(async (req,res) => {
  const avatarLocalPath = req.file?.path;
  if (!avatarLocalPath) {
    throw new ApiError(400, "avatar file for updation is required");
  }

  const updatedAvatar = await uploadOnCloudinary(avatarLocalPath)

  if (!updatedAvatar.url) {
    throw new ApiError(500, "error while uploading avatar on cloudinary");
  }

  const user = await User.findByIdAndUpdate(req.user?._id,
    {
      $set:{
        avatar:updatedAvatar.url
      }
    },
    {
      new:true
    }
  ).select("-password -refreshToken")

  return res
  .status(200)
  .json(new ApiResponse(200,user,"Avatar updated successfully"))
  


});

const updateCoverImage = asyncHandler(async (req,res) => {
  const coverImageLocalPath = req.file?.path;
  if (!coverImageLocalPath) {
    throw new ApiError(400, "coverImage file for updation is required");
  }

  const updatedCoverImage = await uploadOnCloudinary(coverImageLocalPath)

  if (!updatedCoverImage.url) {
    throw new ApiError(500, "error while uploading CoverImage on cloudinary");
  }

  const user = await User.findByIdAndUpdate(req.user?._id,
    {
      $set:{
        coverImage:updatedCoverImage.url
      }
    },
    {
      new:true
    }
  ).select("-password -refreshToken")

  return res
  .status(200)
  .json(new ApiResponse(200,user,"Cover Image updated successfully"))
  


});

const getUserChannelProfile = asyncHandler(async(req,res)=>{
    const { username }= req.params

    if (!(username?.trim())) {
      throw new ApiError(401 , "Username is missing ")
    }

  const channel =  await User.aggregate([
      {
        $match:{
        username : username?.toLowerCase()
        }
      },
      {
        $lookup : {
          from:"subscriptions",
          localField:_id,
          foreignField:"channel",
          as:"subscribers"
        }
      },
      {
        $lookup : {
          from:"subscriptions",
          localField:_id,
          foreignField:"subscriber",
          as:"subscribedTo"
        }
      },
      {
        $addFields:{
          subscribersCount : {
            $size:"$subscribers"
          },
          channelsSubscribedToCount :{
            $size:"$subscribedTo"
          },
          isSubscribed:{
            $cond:{
              if:{$in:[req.user?._id,"$subscribers.subscriber"]},
              then:true,
              else:false
            }
          }
        }
      },
      {
        $project:{
          fullName:1,
          username:1,
          subscribersCount:1,
          channelsSubscribedToCount:1,
          isSubscribed:1,
          avatar:1,
          coverImage:1,
          email:1,
        }
      }
    ])

    //console log this channel

    if (!channel?.length) {
      throw new ApiError(404,"channel does not exists")
    }

    return res
    .status(200)
    .json(
      new ApiResponse(200,channel[0],"User channel fetched successfuly")
    )

})

const getWatchHistory = asyncHandler(async(req,res)=>{
    const user = await User.aggregate([
      {
        $match:{
          _id: mongoose.Types.ObjectId(req.user._id)
        }
      },
      {
        $lookup:{
          from:"videos",
          localField:"watchHistory",
          foreignField:"_id",
          as:"watchHistory",
          pipeline:[
            {
              $lookup:{
                from:"users",
                localField:"owner",
                foreignField:"_id",
                as:"owner",
                pipeline:[
                  {
                    $project:{
                      fullName:1,
                      username:1,
                      avatar:1
                    }
                  }
                ]
              }
            },
            {
              $addFields:{
                owner:{
                  $first:"$owner"
                }
              }
            }
          ]
           
          
        }
      }
    ])

    return res
    .status(200)
    .json(new ApiResponse(
      200,
      user[0].watchHistory,
      "watch history fetched successfully"
    ))
})


export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateAvatar,
  updateCoverImage,
  getUserChannelProfile,
  getWatchHistory
};
