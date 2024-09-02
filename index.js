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


app.get('/', function (req, res) {
    res.send('server is running')
})

async function run() {
    try {
        // post user 
        const dataBase = client.db('afsGames');
        const usersCollection = dataBase.collection('users');
        const GeoCollection = dataBase.collection('geo-json');


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
            const data = req.body;
            if (!data) {
                return res.status(400).send({ error: true, message: 'Invalid geoJSON data' });
            }
            const result = await GeoCollection.insertOne(data);
            res.send(result);
        })


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
