const request = require('request')
const express = require('express')
const app = express()
const mongoose = require('mongoose')
const bodyParser = require('body-parser')
const cors=require('cors')
require('dotenv').config()
const PORT = process.env.PORT || 8080
const mURL = process.env.MONGO_URL
var CFDown = false
var userCount = 0
//const PORT = 8080;
app.use(bodyParser.urlencoded({
  extended: false
}))
app.use(bodyParser.json())
app.use(cors())
mongoose.connect(mURL, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connectionasdf error:'));

db.once('open', function() {
  console.log("Successfully connected to MongoDB!");
});
const userSchema = new mongoose.Schema({
  handle: String,
  data: Object,
})
const User = mongoose.model('User', userSchema)

// app.use(function(req, res, next) {
//   res.setHeader('Access-Control-Allow-Origin', '*');
//   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
//   res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
//   res.setHeader('Access-Control-Allow-Credentials', true);
//   next();
// });

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Credentials', true);
    next()
  });
var problemSet = {};

const isCFDown = () => {
  request(`https://codeforces.com/api/user.info?handles=MikeMirzayanov`, (error, res, body) => {
    try {
      const data = JSON.parse(res.body)
      CFDown = data["status"] !== "OK"
    } catch (error) {
      CFDown = true;
      console.log(error);
    }
  })
}

const updateUserCount = () => {
  User.countDocuments({}, (err, result) => {
    if (err) {
      console.log("error for user count")
      setTimeout(updateUserCount, 1000 * 10);
    } else {
      userCount
        = result
      console.log(userCount)
    }
  })
}
const getWholeData = () => {
  if (CFDown) setTimeout(getWholeData, 1000);
  else {
    request('https://codeforces.com/api/problemset.problems', (err, response, body) => {
      try {
        const data = (JSON.parse(response.body))["result"]
        //re initializing the problem set and tag sets for each query
        problemSet = {}
        data["problems"].filter(problem => problem["index"] >= 'A').forEach(problem => {
          const problemId = problem["contestId"] + problem["index"]
          problemSet[problemId] = {
            "name": problem["name"],
            "tags": problem["tags"],
            "contestId": problem["contestId"],
            "index": problem["index"],
            "rating": problem["rating"] || 0,
          }
          const rating = problemSet[problemId]["rating"];
          if (rating === -1) return;
        })
        data["problemStatistics"].forEach(problem => {
          const problemId = problem["contestId"] + problem["index"]
          if (problemSet[problemId] === undefined) return;
          problemSet[problemId]["solvedBy"] = problem["solvedCount"] || 0
        })
        console.log("Problemset Parsed!")

      } catch {
        console.log("Error parsing problemset!")
        setTimeout(getWholeData, 10 * 1000) //try after 10 seconds
      }
    });
  }

}
const processRequest = (handle, counts, response, low, high) => {

  lastContest = 0,
    userRating = 0,
    newUser = false
  const dataObject = {}
  var AC = new Set(),
    snoozed = new Set(),
    attended = new Set()
  var dbUser = {
    handle,
    data: {
      AC: [],
      snoozed: [],
      lastSubID: 0
    }
  }
  const getUserData = () => {
    request(`https://codeforces.com/api/user.info?handles=${handle}`, (error, res, body) => {
      const data = JSON.parse(res.body)
      if (data["status"] !== "OK") {
        response.json({
          "errorMessage": "User Handle is invalid"
        })
        return;
      }
      User.find({
        handle
      }).then(result => {
        if (result.length === 0) newUser = true
        else dbUser = result[0]
      })
      const user = data["result"][0]
      userRating = user["maxRating"]
      if (userRating === undefined) userRating = 1000;
      dataObject.userHandle = handle
      dataObject.userRating = userRating

      dataObject.userRank = user["rank"]
      dataObject.userPic = user["avatar"]
      dataObject.userFName = user["firstName"]
      dataObject.userLName = user["lastName"]
      dataObject.userOrganization = user["organization"]

      getStatus()
    })
    const getStatus = () => {
      request(`https://codeforces.com/api/user.status?handle=${handle}`, (error, res, body) => {
        try {
          const data = JSON.parse(res.body)
          if (data["status"] !== "OK") {
            response.json({
              "errorMessage": "User Handle is invalid"
            })
            return;
          }
          dbUser.data.AC.forEach(problem => AC.add(problem))
          dbUser.data.snoozed.forEach(problem => snoozed.add(problem))
          data["result"].forEach(submission => {
            const problemId = submission["problem"]["contestId"] + submission["problem"]["index"]
            if (submission["verdict"] === "OK") {
              if (problemSet[problemId] === undefined) return
              AC.add(problemId)
            }
            attended.add(submission["problem"]["contestId"])
          })
          dbUser.data.lastSubID = Math.max(dbUser.data.lastSubID, data["result"][0]["id"])
          dbUser.data.AC = []
          AC.forEach(problem => dbUser.data.AC.push(problem))
          if (newUser) {
            const newDBUser = new User(dbUser)
            newDBUser.save().then(() => console.log("User Added:", dbUser.handle))
          } else User.findByIdAndUpdate(dbUser._id, dbUser, {
            new: true
          })
        } catch (err) {
          console.log(err)
          response.json({
            errorMessage: "Some error occurred! try again later!"
          })
        } finally {
          getLast()
        }
      })
    }

    const getLast = () => {
      request(`https://codeforces.com/api/user.rating?handle=${handle}`, (err, res, body) => {
        try {
          const data = JSON.parse(res.body)
          if (data["status"] === "OK" && data["result"].length) lastContest = data["result"][data["result"].length - 1]["contestId"]
        } catch (err) {
          console.log(err)
          response.json({
            errorMessage: "Some error occurred! Please try again later!"
          })
        } finally {
          getSuggestion()
        }
      })
    }

    const getSuggestion = () => {
      ///recommended problem according to user preference
      var easy = [],
        medium = [],
        hard = [],
        ///unsolved problems from last contest
        solveNext = [],
        ///problems from past contests
        pastContest = {
          easy: [],
          medium: [],
          hard: []
        }
      userRating = Math.floor(userRating / 100) * 100
      if (low === undefined) low = userRating - 250
      if (low < 0) low = 0;
      if (high === undefined) high = userRating + 250
      if (high > 3000) high = 3000
      dataObject.ratingLow = low
      dataObject.ratingHigh = high
      dataObject.problemSet = {}
      for (var problem in problemSet) {
        if (problemSet[problem]["rating"] < low - 500 || problemSet[problem]["rating"] > high + 500) continue
      }
      for (var problem in problemSet) {
        if (problemSet[problem]["contestId"] === lastContest && !(AC.has(problem)) && !(snoozed.has(problem))) {
          solveNext.push({
            contestId: lastContest,
            index: problemSet[problem]["index"],
            name: problemSet[problem]["name"],
            tags: problemSet[problem]["tags"],
            solvedBy: problemSet[problem]["solvedBy"],
            solved: false,
            practiceTime: 60
          })
          continue
        }
        if (problemSet[problem]["rating"] < low - 500 || problemSet[problem]["rating"] > high + 500) continue
        if (AC.has(problem) || snoozed.has(problem)) continue
        const problemObject = {
          name: problemSet[problem]["name"],
          rating: problemSet[problem]["rating"],
          contestId: problemSet[problem]["contestId"],
          index: problemSet[problem]["index"],
          solvedBy: problemSet[problem]["solvedBy"],
          solved: false,
          tags: problemSet[problem]["tags"],

        }
        if (problemSet[problem]["rating"] < low && problemSet[problem]["rating"] > low - 500) {
          problemObject["practiceTime"] = 30
          if (attended.has(problemSet[problem]["contestId"])) pastContest.easy.push(problemObject)
          else easy.push(problemObject)
        } else if (problemSet[problem]["rating"] <= high && problemSet[problem]["rating"] >= low) {
          problemObject["practiceTime"] = 45
          if (attended.has(problemSet[problem]["contestId"])) pastContest.medium.push(problemObject)
          else medium.push(problemObject)
        } else if (problemSet[problem]["rating"] < high + 500 && problemSet[problem]["rating"] > high) {
          problemObject["practiceTime"] = 60
          if (attended.has(problemSet[problem]["contestId"])) pastContest.hard.push(problemObject)
          else hard.push(problemObject)
        }
      }
      dataObject.problemSet.easy = easy.sort((a, b) => b.solvedBy - a.solvedBy).slice(0, Math.min(Math.max(0, counts.easy), easy.length))
      dataObject.problemSet.medium = medium.sort((a, b) => b.solvedBy - a.solvedBy).slice(0, Math.min(Math.max(0, counts.medium), medium.length))
      dataObject.problemSet.hard = hard.sort((a, b) => b.solvedBy - a.solvedBy).slice(0, Math.min(Math.max(0, counts.hard), hard.length))
      dataObject.problemSet.solveNext = solveNext.sort((a, b) => a["index"] < b["index"])
      dataObject.problemSet.pastContest = {}
      for (var key in pastContest) dataObject.problemSet.pastContest[key] = pastContest[key].sort((a, b) => b.solvedBy - a.solvedBy).slice(0, Math.min(pastContest[key].length, 3))
      response.json(dataObject)
    }
  }

  getUserData()
}
const verifySubmission = (handle, cid, index, response) => {
  request(`https://codeforces.com/api/user.status?handle=${handle}&from=1&count=1000`, (err, res, body) => {
    const data = JSON.parse(res.body)
    if (data["status"] !== "OK") {
      response.json({
        "errorMessage": "Some error occurred. try again!"
      })
      return
    }
    let found = false
    data["result"].forEach(submission => {
      if (submission["problem"]["contestId"] === cid && submission["problem"]["index"] === index && submission["verdict"] === "OK") {
        found = true
      }
    })
    response.json({
      verified: found
    })
  })
}

const skipQuestion = (handle, pid, response) => {
  try {
    User.find({
      handle
    }).then(result => {
      const dbUser = result[0]
      dbUser.data.AC.push(pid)
      User.findByIdAndUpdate(dbUser._id, dbUser, {
        new: true
      }).then(newDBUser => {
        console.log("User updated:", newDBUser.handle)
        response.json({
          skipped: true
        })
      })
    })
  } catch (err) {
    response.json({
      errorMessage: "Some error occurred! try again later!"
    })
  }
}

app.get('/suggest/:handle/:easy/:medium/:hard/:low?/:high?', (request, response) => {
  if (CFDown) {
    response.json({
      errorMessage: "Codeforces is down"
    })
    return response.end()
  }
  const handle = request.params.handle
  const counts = {
    easy: Number(request.params.easy),
    medium: Number(request.params.medium),
    hard: Number(request.params.hard),
  }
  setTimeout(() => processRequest(handle, counts, response, request.params.low, request.params.high), 100 * (Object.keys(problemSet).length === 0))
})

app.get('/verify/:handle/:contestId/:index', (request, response) => {
  if (CFDown) {
    response.json({
      errorMessage: "Codeforces is down at the moment!"
    })
    return response.end()
  }
  const handle = request.params.handle
  const cid = Number(request.params.contestId)
  const index = request.params.index
  verifySubmission(handle, cid, index, response)
})

app.get('/skip/:handle/:pid', (request, response) => {
  skipQuestion(request.params.handle, request.params.pid, response)
})

app.get('/usercount', (request, response) => {
  response.json({
    count: usercount
  })
})
app.get('/later/:handle/:pid', (request, response) => {
  try {
    User.find({
      handle: request.params.handle
    }).then(result => {
      const dbUser = result[0]
      dbUser.data.snoozed.push(request.params.pid)
      User.findByIdAndUpdate(dbUser._id, dbUser, {
        new: true
      }).then(newDBUser => {
        console.log("User updated:", newDBUser.handle)
        response.json({
          saved: true
        })
      })
      setTimeout(() => {
        User.find({
          handle: dbUser.handle
        }).then(result => {
          const newDBUser = result[0]
          newDBUser.data.snoozed = newDBUser.data.snoozed.filter(prob => prob !== request.params.pid)
          User.findByIdAndUpdate(newDBUser._id, newDBUser, {
            new: true
          }).then(remSnooze => console.log("User updated:", remSnooze.handle))
        })
      }, 3 * 24 * 3600 * 1000) //problem will be snoozed for 3 days
    })
  } catch (err) {
    response.json({
      errorMessage: "Some error occurred! Please try again later!"
    })
  }
})
app.listen(PORT, () => {
  console.log("Server started!");
  getWholeData();
  isCFDown();
  updateUserCount();
  setInterval(getWholeData, 3600 * 1000); //get data every one hour
  setInterval(isCFDown, 60 * 1000); //check cf status every minute
  setInterval(updateUserCount, 60 * 1000); //update user count every minute
  console.log("data retrieved");
});
