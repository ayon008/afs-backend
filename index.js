var express = require('express')
require('dotenv').config()
var jwt = require('jsonwebtoken');
var cors = require('cors')
var app = express()
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://ayon008:${process.env.USER_PASSWORD}@cluster0.mptmg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

app.use(cors())
app.use(express.json())

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


// VERIFY TOKENS
const verify = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
        if (error) {
            console.log(error);
            return res.status(401).send({ error: true, message: 'unauthorized access' });
        } else {
            req.decoded = decoded;
            next();
        }
    });
}


const updatePointTable = async (name, uid, category, pointsByDistance, pointsByTime, collection) => {
    const query = { uid: uid };
    const options = { upsert: true };

    // Calculate total points for the specific category
    const totalCategoryPoints = pointsByDistance + pointsByTime;

    // Construct the update data
    const updatedData = {
        $set: {
            name: name,
            uid: uid,
        },
        $inc: {
            // Increment the points for the specific category
            [`category.${category}.pointsByDistance`]: pointsByDistance,
            [`category.${category}.pointsByTime`]: pointsByTime,
            [`category.${category}.total`]: totalCategoryPoints,

            // Increment the global points and total
            pointsByDistance: pointsByDistance,  // Add to global distance points
            pointsByTime: pointsByTime,          // Add to global time points
            total: totalCategoryPoints           // Add to global total points
        }
    };

    // Execute the update
    const result = await collection.updateOne(query, updatedData, options);
    return result;
};



app.get('/', function (req, res) {
    res.send('server is running')
})

async function run() {
    try {
        // post user 
        const dataBase = client.db('afsGames');
        const usersCollection = dataBase.collection('users');
        const GeoCollection = dataBase.collection('geo-json');
        const pointTable = dataBase.collection('point-table');


        // Post user Email and get token
        app.post('/userToken', async (req, res) => {
            try {
                const { email } = req.body;

                // Input validation
                if (!email || typeof email !== 'string') {
                    return res.status(400).send({ error: true, message: 'Invalid email format' });
                }

                // Generate JWT token
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' });

                // Send the token as a response
                res.send({ token });
            } catch (error) {
                console.error('Error generating token:', error);
                res.status(500).send({ error: true, message: 'Internal server error' });
            }
        });


        // Post user Details to database
        app.post('/user', async (req, res) => {
            try {
                const data = req.body;

                // Validate input data
                if (!data || !data.email) {
                    return res.status(400).send({ error: true, message: 'Invalid user data' });
                }

                const query = { $or: [{ uid: data.uid }, { email: data.email }] };
                const userExists = await usersCollection.findOne(query);

                if (userExists) {
                    return res.status(409).send({ message: 'User already exists' });
                }
                else {
                    const result = await usersCollection.insertOne(data);
                    if (result.acknowledged && result.insertedId) {
                        return res.status(201).send({ message: 'User added successfully', user: { _id: result.insertedId, ...data } });
                    } else {
                        return res.status(500).send({ error: true, message: 'Failed to add user' });
                    }
                }
            } catch (error) {
                console.error('Error inserting user:', error);
                res.status(500).send({ error: true, message: 'Internal server error' });
            }
        });


        // Get user by uid
        app.get('/user/:uid', verify, async (req, res) => {
            try {
                const uid = req.params.uid;

                // Validate the UID
                if (!uid) {
                    return res.status(400).send({ error: true, message: 'Invalid UID' });
                }
                // Query to find the user by UID
                const query = { uid: { $eq: uid } };
                const user = await usersCollection.findOne(query);

                if (req.decoded.email !== user.email) {
                    return res.status(401).send({ message: 'Invalid token' });
                }

                if (user) {
                    res.status(200).send(user);
                } else {
                    res.status(404).send({ error: true, message: 'User not found' });
                }
            } catch (error) {
                console.error('Error fetching user:', error);
                res.status(500).send({ error: true, message: 'Internal server error' });
            }
        });


        // Update user by _id 
        app.patch('/user/:id', verify, async (req, res) => {
            try {
                console.log('clicked');
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const options = { upsert: true };
                const data = req.body;

                if (req.decoded.email !== data.email) {
                    return res.status(401).send({ message: 'Unauthorized Access' });
                }

                // Prepare update operation
                const updatedData = {
                    $set: {
                        displayName: data.displayName,
                        surName: data.surName,
                        pays: data.pays,
                        afsGear: data.afsGear,
                        address: data.address,
                        photoURL: data.photoURL
                    }
                };

                // Perform update operation
                const result = await usersCollection.updateOne(query, updatedData, options);

                if (result.matchedCount === 0 && result.upsertedCount === 0) {
                    return res.status(404).send({ error: true, message: 'User not found' });
                }

                res.send({ message: 'User updated successfully', result });
            } catch (error) {
                console.error('Error updating user:', error);
                res.status(500).send({ error: true, message: 'Internal server error' });
            }
        });

        // upload geoJSON
        app.post('/geoJson', async (req, res) => {
            try {
                const data = req.body;

                // Input validation: Check if required fields are provided
                if (!data || !data.uid || !data.category || !data.name || !data.pointsByTime || !data.pointsByDistance) {
                    return res.status(400).send({ error: true, message: 'Invalid input. Required fields are missing.' });
                }

                const { uid, category, name, pointsByTime, pointsByDistance } = data;
                const point = pointsByTime + pointsByDistance;

                // Insert the geoJSON data into the collection
                const result = await GeoCollection.insertOne(data);

                // Check if the insert was acknowledged by MongoDB
                if (result.acknowledged) {
                    // Call updatePointTable function to update the points
                    await updatePointTable(name, uid, category, pointsByDistance, pointsByTime, pointTable); // Ensure updatePointTable is awaited if it's async
                    return res.status(201).send({ success: true, message: 'Data inserted and points updated', result });
                } else {
                    return res.status(500).send({ error: true, message: 'Data insertion failed' });
                }
            } catch (error) {
                console.error('Error in /geoJson route:', error);
                // Handle server errors
                return res.status(500).send({ error: true, message: 'Server error occurred', details: error.message });
            }
        });

        app.get('/totalPoints', async function (req, res) {
            const uid = req.query.uid;

            // Validate the UID
            if (!uid) {
                return res.status(400).json({ error: 'UID is required' });
            }

            try {
                // Check if the collection is empty
                const isCollectionEmpty = await pointTable.countDocuments() === 0;
                if (isCollectionEmpty) {
                    return res.status(200).json([]); // Return empty array if collection is empty
                }

                // Fetch user points from the database
                const user = await pointTable.findOne({ uid });

                if (!user) {
                    const topThreeUsers = await pointTable.find({})
                        .sort({ total: -1 }) // Sort by total points in descending order
                        .limit(3)
                        .toArray();

                    // Calculate positions for the top 3 users
                    const response = await Promise.all(topThreeUsers.map(async (user, index) => ({
                        ...user,
                        position: index + 1 // Assign position based on the index
                    })));

                    return res.status(200).json(response); // Return top 3 users with positions
                }

                const userPoints = user.total;

                // Fetch one higher user
                const higher = await pointTable.find({ total: { $gt: userPoints } })
                    .sort({ total: -1 })
                    .limit(1)
                    .toArray();

                // Fetch two lower users
                const lower = await pointTable.find({ total: { $lt: userPoints } })
                    .sort({ total: -1 })
                    .limit(2)
                    .toArray();

                let response = [];

                // Case 1: User has the highest points
                if (higher.length === 0) {
                    const lowerPositions = await Promise.all(lower.map(async (user) => ({
                        ...user,
                        position: await pointTable.countDocuments({ total: { $gt: user.total } }) + 1
                    })));

                    response = [
                        { ...user, position: 1 }, // User is at the top
                        ...lowerPositions // Two lower users
                    ];
                }
                // Case 2: User has the lowest points
                else if (lower.length === 0) {
                    const additionalHigher = await pointTable.find({ total: { $gt: userPoints } })
                        .sort({ total: -1 })
                        .skip(1)
                        .limit(2)
                        .toArray();

                    const higherPositions = await Promise.all(additionalHigher.map(async (user) => ({
                        ...user,
                        position: await pointTable.countDocuments({ total: { $gt: user.total } }) + 1
                    })));

                    response = [
                        { ...higher[0], position: await pointTable.countDocuments({ total: { $gte: higher[0].total } }) + 1 },
                        ...higherPositions,
                        { ...user, position: await pointTable.countDocuments({ total: { $gte: userPoints } }) + 1 }
                    ];
                }
                // Case 3: User is in the middle
                else {
                    const higherPosition = await pointTable.countDocuments({ total: { $gte: higher[0].total } }) + 1;
                    const lowerPositions = await Promise.all(lower.map(async (user) => ({
                        ...user,
                        position: await pointTable.countDocuments({ total: { $gt: user.total } }) + 1
                    })));

                    response = [
                        { ...higher[0], position: higherPosition }, // One higher user
                        { ...user, position: await pointTable.countDocuments({ total: { $gte: userPoints } }) + 1 }, // Current user
                        ...lowerPositions // One lower user
                    ];
                }

                // Return only the 3 required users (current user, higher, and lower)
                return res.status(200).json(response);
            } catch (error) {
                console.error('Error fetching leaderboard data:', error.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        });


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error

    }
}

app.listen(port, () => {
    console.log('Afs run is running', port);
})



run().catch(console.dir);
