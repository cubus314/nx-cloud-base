const functions = require('firebase-functions');

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

//references to look at:stackoverflow.com/questions/43913139/firebase-http-cloud-functions-read-database-once

const admin = require('firebase-admin');

const myCredentials = require('./mycredentials');

const config = functions.config();
admin.initializeApp(config.firebase);
var refKey = "ref";

function notFoundDirectly(dbKey, dbKeyFull, req, res, errtext)  {
    //so lets try regexp match; there we use dbKeyFull, which is the full url, not only the user part!
    console.log("notFoundDirectly called with dbKeyFull " + dbKeyFull + " and error text " + errtext);
    var dbRef = admin.database().ref("regexp");
    dbRef.once('value', (snapshot) => {
       var dest = JSON.stringify(snapshot);
       if (dest === 'null') {
          console.log("sending 404 response a");
          res.status(404).send(errtext);
          return;
       }
       var no_match = true;
       snapshot.forEach(function(childSnapshot) {
           var val = childSnapshot.val();
           var key = childSnapshot.key;
           key_cleartext = Buffer.from(key, 'base64').toString();
           console.log("Found regexp: " + key_cleartext + ":" + val);
           var re = new RegExp(key_cleartext);
           var firstSlashIndex = dbKeyFull.indexOf("/");
           var topKey;
           var bottomKey;
           if (firstSlashIndex>=0) {
               topKey = dbKeyFull.substr(0, firstSlashIndex);
               bottomKey = dbKeyFull.substr(firstSlashIndex+1);
           }
           else {
               topKey = dbKeyFull;
               bottomKey = null;
           }
           var matchres = topKey.match(re);
           if (matchres) {
               console.log("match for " + topKey + ".match(/" + key_cleartext + ")");
               var midx = 0;
               while (matchres[midx]) {
                   console.log("regexp subexpression $" + midx + " = " + matchres[midx]);
                   midx++;
               }
               var newDbKey = "regexp/" + key;
               if (bottomKey !== null)
                   newDbKey = newDbKey + "/" + bottomKey;
               no_match = false;
               onRequestInner(req, res, newDbKey, dbKeyFull, 0, matchres);//todo: how to avoid to get here again if not found???
               return;
           }
           else
               console.log("NO match for " + topKey + ".match(/" + key_cleartext + ")");
       });
       if (no_match) {
           console.log("sending 404 response b");
           res.status(404).send(errtext);
           return;
       }
    });
}

function followRef(dbKey, dbKeyFull, req, res, nest_count) {
    //check if there is a ref key on the current level (instead of the reqeusted key on this level)
    //if yes, replace the key on the next higher level with the value of the ref
    //-split dbKey 
    console.log("followRef called with " + dbKey);
    var leafKey;
    var lastSlashIndex = dbKey.lastIndexOf("/");
    if (lastSlashIndex > 0)
       leafKey = dbKey.substr(lastSlashIndex+1);
    else {
       notFoundDirectly(dbKey, dbKeyFull, req, res, "Not found, f1: " + dbKey);
       return;
    }
    var pathHigher = dbKey.substr(0, lastSlashIndex);
    var refPath = pathHigher + "/" + refKey;
    console.log("refPath is " + refPath);
    var refRef = admin.database().ref(refPath);
    refRef.once('value', (snapshot) => {
       var dest = JSON.stringify(snapshot);
       if ((dest.charAt(0)==='"') && (dest.charAt(dest.length-1)==='"'))
          dest = dest.substr(1, dest.length-2); //take away quotes around the key string
       else {
          console.log("Got bad result from DB at " + refPath + ": " + dest);
          notFoundDirectly(dbKey, dbKeyFull, req, res, "Not found, f2: " + refPath);
          return;
       }
       console.log("Reference Destination is " + dest);
       var topPath = "";
       var topSlashIndex = pathHigher.lastIndexOf("/");
       if (topSlashIndex >=0)
          topPath = pathHigher.substr(0, topSlashIndex+1);
       var newDbKey = topPath + dest + "/" + leafKey;
       var regexp_str = "regexp/";
       //if the regexp line contains a ref, the ref is to a direct destination,cut of 'regexp/' at top of path
       idx_regexp = newDbKey.indexOf(regexp_str);
       if (idx_regexp === 0)
          newDbKey = newDbKey.substr(regexp_str.length);
       onRequestInner(req, res, newDbKey, dbKeyFull, nest_count +1, undefined);
    });
    
}

function regexp_replace(dest, matchres) {
    console.log("regexp_replace(" + dest + ", " + matchres + "-->");
    midx = 0;
    if (matchres) {
        while (matchres[midx]) {
            var regex = new RegExp('\\$' + midx, 'gi');
            //var regex = /\$1/gi;
console.log("regexp_replace, regex = " + regex + ", matchres_i = " + matchres[midx]);
            dest = dest.replace(regex, matchres[midx]);
            midx++;
        }
    }
    console.log("--> " + dest);
    return dest;
}

//request something from the database
function onRequestInner(req, res, dbKey, dbKeyFull, nest_count, matchres) {

    console.log("onRequestInner called with dbKey " + dbKey);

    //make sure to avoid enless recursive calls
    if (nest_count > 6) {
        notFoundDirectly(dbKey, dbKeyFull, req, res, "Too many recursions: " + nest_count);
        return;
    }
    else
       console.log("onRequestInner: dbKey is " + dbKey + ", nest count is " + nest_count);

    var dbRef;
    if (dbKey.length >= 1)
        dbRef = admin.database().ref(dbKey);
    else
        dbRef = admin.database().ref();
        
    dbRef.once('value', (snapshot) => {
       var dest = JSON.stringify(snapshot);
       console.log("Destination is " + JSON.stringify(snapshot));
       //send the response from this callback function
       if (dest === 'null') {
         //requested DB element not found, try possible references to another element
         followRef(dbKey, dbKeyFull, req, res, nest_count+1);
       }
       else {
         dest = regexp_replace(dest, matchres);
         console.log("sending 200 resonse");
         res.contentType("application/json");
         res.status(200).send(dest);
       }
    });
}

function getUrlFromPath(path) {
    var firstslashindex = path.indexOf('/', 0);
    if (firstslashindex < 0) {
        console.log("sending 400 resonse");
        res.status(400).send("Bad request - first / not found in something like /forwardInfo/13?auth=..., with 13 being dialed number");
        return;
    }
    var secondslashindex = path.indexOf('/', firstslashindex+1);
    if (secondslashindex < 0) {
        console.log("sending 400 resonse");
        res.status(400).send("Bad request - second / not found in something like /forwardInfo/13?auth=..., with 13 being dialed number");
        return;
    }
    var url = path.substring(secondslashindex  + 1); //Note: dbKey may be empty string in which case it points to the DB-root (for getting the whole DB-tree)
    return url;
}

exports.forwardInfo = functions.https.onRequest((req, res) => {

    var reqInfo = "req.baseUrl is " + req.baseUrl
                + ", req.body is " + JSON.stringify(req.body) 
                + ", req.cookies is " + req.cookies 
                + ", req.hostname is " + req.hostname 
                + ", req.ip is " + req.ip 
                + ", req.method is " + req.method 
                + ", req.params is " + JSON.stringify(req.params) 
                + ", req.path is " + req.path 
                + ", req.protocol is " + req.protocol 
                + ", req.query is " + JSON.stringify(req.query) 
                + ", req.get for Content-Type is " + req.get('Content-Type')
                + ", req.get for Authorization is " + req.get('Authorization')
                ;

    console.log("request is " + reqInfo);
    if (!req.query.auth) {
        console.log("sending 401 resonse");
        res.status(401).send("Not authorized - missing query parameter ?auth=...");
        return;
    }

    let myAuth = myCredentials.my_auth(); // myAuth is "Rr...nI" 

//    if (req.query.auth !== 'RrSY7r6KzJfYiM5GhQw7nL5c1NkvPdTe6sgTrpnI') { //I use here the same value like the legacy database secret...
    if (req.query.auth !== myAuth) { //I use here the same value like the legacy database secret...
        console.log("authenticaton failed, sending 401 resonse");
        res.status(401).send("Not authorized - incorrect query parameter ?auth=...");
        return;
    }
    var path = req.path;

    var dbKey = getUrlFromPath(path);
    var dbKeyFull = dbKey;
    var atIndex = dbKey.indexOf('@');
    if (atIndex>=0) //cut out the @domain.com part in 'user@domain.com/field', only the user part is used to address our DB element
    {
        var dbKeyMod = dbKey.substring(0, atIndex); //this gets the first part before the @
        var slash_idx = dbKey.indexOf('/', atIndex);
        if (slash_idx >= 0)
            dbKeyMod = dbKeyMod + dbKey.substring(slash_idx); //this gets the last part after ...@domain.com/
        dbKey = dbKeyMod;
    }
    // get value from database 
    onRequestInner(req, res, dbKey, dbKeyFull, 0, undefined);
    return;
});
