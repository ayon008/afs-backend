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
            // console.log(error);
            return res.status(401).send({ error: true, message: 'unauthorized access' });
        } else {
            req.decoded = decoded;
            next();
        }
    });
}

const updatePointTable = async (displayName, uid, pays, photoURL, collection, category, WatermanCrown, totalTime, session, distance, city, lastUploadedTime) => {
    try {
        // Input validation
        if (!uid || typeof uid !== 'string') throw new Error('Invalid UID');
        if (!displayName || typeof displayName !== 'string') throw new Error('Invalid display name');
        if (!category || typeof category !== 'string') throw new Error('Invalid category');
        // Prepare the query and options
        const query = { uid: uid };
        const options = { upsert: true };
        // If the document doesn't exist, create a new one
        // Construct the update data
        const updatedData = {
            $set: {
                displayName: displayName,
                uid: uid,
                photoURL: photoURL,
                pays: pays,
                WatermanCrown: WatermanCrown,
                city: city,
                lastUploadedTime: lastUploadedTime
            },
            $inc: {
                [`${category}`]: totalTime,
                [`${category}Distance`]: distance,
                [`${category}Session`]: session,
                session: session,
                total: totalTime,
                distance: distance
            }
        };

        // Execute the update and return the result
        const result = await collection.updateOne(query, updatedData, options);

        if (result.matchedCount === 0 && result.upsertedCount === 0) {
            throw new Error('No document found or created');
        }

        return result;
    } catch (error) {
        // Handle errors in production by logging them and throwing
        console.error('Error updating point table:', error);
        throw new Error('Failed to update point table');
    }
};


const decreasePointTable = async (displayName, uid, pays, photoURL, collection, category, WatermanCrown, totalTime, session, distance, city, lastUploadedTime, pointTable) => {
    try {
        // Input validation
        if (!uid || typeof uid !== 'string') throw new Error('Invalid UID');
        if (!displayName || typeof displayName !== 'string') throw new Error('Invalid display name');
        if (!category || typeof category !== 'string') throw new Error('Invalid category');

        // Prepare the query and options
        const query = { uid: uid };
        const options = { upsert: true }; // If the document doesn't exist, create a new one
        // Construct the update data
        const updatedData = {
            $set: {
                displayName: displayName,
                uid: uid,
                photoURL: photoURL,
                pays: pays,
                WatermanCrown: WatermanCrown,
                city: city,
                lastUploadedTime: lastUploadedTime
            },
            $inc: {
                [`${category}`]: -totalTime,
                [`${category}Distance`]: -distance,
                [`${category}Session`]: -session,
                session: -session,
                total: -totalTime,
                distance: -distance
            }
        };

        // Execute the update and return the result
        const result = await collection.updateOne(query, updatedData, options);
        const filter = { $and: [{ uid: uid }, { total: 0 }] }

        const point = await pointTable.deleteOne(filter);
        console.log(point);

        if (result.matchedCount === 0 && result.upsertedCount === 0) {
            throw new Error('No document found or created');
        }

        return result;
    } catch (error) {
        // Handle errors in production by logging them and throwing
        console.error('Error updating point table:', error);
        throw new Error('Failed to update point table');
    }
};

app.get('/', function (req, res) {
    res.send('afs server is running')
})

async function run() {
    try {
        // post user 
        const dataBase = client.db('afsGames');
        const usersCollection = dataBase.collection('users');
        const GeoCollection = dataBase.collection('geo-json');
        const pointTable = dataBase.collection('point-table');
        const sponsors = dataBase.collection('sponsors');
        const events = dataBase.collection('events');
        const awards = dataBase.collection('awards');
        const faq = dataBase.collection('faq');

        const verifyAdmin = async (req, res, next) => {
            const adminEmail = req.decoded.email;
            const query = { email: { $eq: adminEmail } }
            const findAdmin = await usersCollection.findOne(query);
            if (findAdmin.admin !== true) {
                return res.status(403).send({ error: true, message: 'unauthorized access' })
            }
            next();
        }

        app.get('/user/admin/:email', verify, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(401).send({ message: 'Invalid token' });
            }
            const query = { email };
            const find = await usersCollection.findOne(query);
            res.send({ admin: find?.role === 'admin' });
        });


        // Post user Email and get token
        app.post('/userToken', async (req, res) => {
            try {
                const { email } = req.body;

                // Input validation
                if (!email || typeof email !== 'string') {
                    return res.status(400).send({ error: true, message: 'Invalid email format' });
                }

                const userData = await usersCollection.findOne({ email: { $eq: email } });

                if (!userData) {
                    return res.status(404).json({ error: true, message: 'User not found' });
                }

                // Generate JWT token
                const token = jwt.sign({ email, admin: userData.admin }, process.env.ACCESS_TOKEN, { expiresIn: '1h' });
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
                        return res.status(201).send({
                            message: 'User added successfully',
                            user: { _id: result.insertedId, ...data }
                        });
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
        app.get('/user/:uid', async (req, res) => {
            try {
                const uid = req.params.uid;
                // Validate the UID
                if (!uid) {
                    return res.status(400).send({ error: true, message: 'Invalid UID' });
                }
                // Query to find the user by UID
                const query = { uid: { $eq: uid } };
                const user = await usersCollection.findOne(query);

                if (user) {
                    res.status(200).send(user);
                } else {
                    res.status(404).send({ error: true, message: 'User not found' });
                }
            } catch (error) {
                console.error('Error fetching user:', error);
                console.log(error.message);

                res.status(500).send({ error: true, message: 'Internal server error' });
            }
        });


        // get all users

        app.get('/allUsers', verify, verifyAdmin, async (req, res) => {
            const data = await usersCollection.find().toArray();
            res.send(data);
        })

        // Update user by _id 
        app.patch('/user/:id', verify, async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const options = { upsert: true };
                const data = req.body;
                const { displayName, photoURL, uid, surName, pays, city } = data;

                if (req.decoded.email !== data.email) {
                    return res.status(401).send({ message: 'Unauthorized Access' });
                }
                // Prepare update operation
                const updatedData = {
                    $set: {
                        displayName: data.displayName,
                        surName: data.surName,
                        pays: data.pays,
                        invoiceURL: data.invoiceURL,
                        city: data.city,
                        photoURL: data.photoURL
                    }
                };

                // Perform update operation
                const result = await usersCollection.updateOne(query, updatedData, options);

                if (result) {
                    await pointTable.updateOne({ uid: { $eq: uid } },
                        { $set: { displayName: data?.displayName, photoURL: data?.photoURL, surName: data?.surName, pays: data?.pays, city: data?.city } }, {});
                }

                if (result.matchedCount === 0 && result.upsertedCount === 0) {
                    return res.status(404).send({ error: true, message: 'User not found' });
                }

                res.send({ message: 'User updated successfully', result });
            } catch (error) {
                console.error('Error updating user:', error);
                res.status(500).send({ error: true, message: 'Internal server error' });
            }
        });


        // Delete a user
        app.delete('/user/:uid', async (req, res) => {
            const uid = req.params.uid; // Extract the uid from the URL parameters
            try {
                // Attempt to delete the user document from the collection
                const response = await usersCollection.deleteOne({ uid });

                // Send a response indicating success or failure
                if (response.deletedCount === 0) {
                    // If no documents were deleted, send a 404 status
                    return res.status(404).send({ message: 'User not found' });
                }

                // Send a 200 status if deletion was successful
                res.status(200).send({ message: 'User deleted successfully' });
            } catch (error) {
                // Handle any errors that occurred during the deletion process
                console.error(error);
                res.status(500).send({ message: 'An error occurred while deleting the user' });
            }
        });

        // upload geoJSON
        app.post('/geoJson', async (req, res) => {
            try {

                // geoData
                const data = req.body;

                // Input validation: Check if required fields are provided
                if (!data || !data.uid || !data.category || !data.totalTime) {
                    return res.status(400).send({ error: true, message: 'Invalid input. Required fields are missing.' });
                }

                const { category, totalTime, uid, status, distance } = data;

                const lastUploadedTime = new Date();

                const userData = await usersCollection.findOne({ uid: { $eq: uid } });
                const { displayName,
                    photoURL,
                    pays,
                    WatermanCrown,
                    city
                } = userData;

                // Insert the geoJSON data into the collection
                const result = await GeoCollection.insertOne({ ...data, lastUploadedTime });

                // Check if the insert was acknowledged by MongoDB
                if (result.acknowledged) {
                    // Call updatePointTable function to update the points
                    if (status) {
                        await updatePointTable(displayName, uid, pays, photoURL, pointTable, category, WatermanCrown, totalTime, 1, distance, city, lastUploadedTime);
                    } // Ensure updatePointTable is awaited if it's async
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

        // get GEoJSon
        app.get('/geoJson', async (req, res) => {
            const data = await GeoCollection.find().toArray();
            res.send(data);
        })


        app.patch('/updateStatus/:id', verify, verifyAdmin, async (req, res) => {
            const statusGPX = req.body.status;
            console.log(statusGPX);

            const id = req.params.id;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: true, message: 'Invalid ID format' });
            }
            const query = { _id: new ObjectId(id) };
            try {
                // Find the GPX document by ID
                const findGPX = await GeoCollection.findOne(query);

                if (!findGPX) {
                    return res.status(404).json({ error: true, message: 'GPX file not found' });
                }

                // Update the status field in the GPX document
                const updateStatus = await GeoCollection.updateOne(query, { $set: { status: statusGPX } });

                if (updateStatus.modifiedCount === 0) {
                    return res.status(500).json({ error: true, message: 'Failed to update status' });
                }

                const { category, totalTime, uid, status, distance, lastUploadedTime } = findGPX;

                // Find the corresponding user by UID
                const userData = await usersCollection.findOne({ uid });

                if (!userData) {
                    return res.status(404).json({ error: true, message: 'User not found' });
                }

                const {
                    displayName,
                    photoURL,
                    pays,
                    WatermanCrown,
                    city
                } = userData;

                // Update the point table if the status has been changed
                if (statusGPX === true) {
                    await updatePointTable(
                        displayName,
                        uid,
                        pays,
                        photoURL,
                        pointTable,
                        category,
                        WatermanCrown,
                        totalTime,
                        1, // Assuming this is the points you want to add
                        distance,
                        city,
                        lastUploadedTime
                    );
                }
                if (statusGPX === false) {
                    await decreasePointTable(
                        displayName,
                        uid,
                        pays,
                        photoURL,
                        pointTable,
                        category,
                        WatermanCrown,
                        totalTime,
                        1, // Assuming this is the points you want to add
                        distance,
                        city,
                        lastUploadedTime,
                        pointTable
                    )
                }

                // Send the updated status response
                res.status(200).json({
                    success: true,
                    message: 'Status updated successfully',
                    updateStatus
                });

            } catch (error) {
                console.error('Error updating status:', error);
                res.status(500).json({ error: true, message: 'Internal server error' });
            }
        });

        app.get('/totalPoints', async (req, res) => {
            const query = { total: { $gt: 0 } }
            const find = await pointTable.find(query).sort({ total: -1 }).toArray();
            res.send(find);
        })

        app.get('/fileName/:uid', async (req, res) => {
            const uid = req.params.uid;
            console.log(uid);
            const query = { uid: uid };
            const options = {
                projection: { filename: 1, status: 1 },
            }
            const files = await GeoCollection.find(query, options).toArray();
            console.log(files);
            res.send(files);
        })

        app.get('/sponsors', async (req, res) => {
            const data = await sponsors.find().toArray();
            res.send(data);
        })

        app.post('/sponsors', async (req, res) => {
            const data = req.body;
            const result = await sponsors.insertOne(data);
            res.send(result);
        })

        app.delete('/sponsors/:id', async (req, res) => {
            const id = req.params.id;
            console.log(id);
            const result = await sponsors.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        })

        app.patch('/approved/:id', async (req, res) => {
            const id = req.params.id;
            const approved = req.body.approved;
            const query = { _id: new ObjectId(id) };
            const updatedData = {
                $set: { approved: approved }
            }
            const result = await usersCollection.updateOne(query, updatedData, {});
            res.send(result);
        })


        app.delete('/fileName/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await GeoCollection.deleteOne(query);
            res.send(result);
        })

        app.post('/addAwards', async (req, res) => {
            const data = req.body
            const category = data.category;
            const position = data.position;
            const query = { $and: [{ category: { $eq: category } }, { position: { $eq: position } }] };
            const options = { upsert: true };
            const updatedData = {
                $set: {
                    category: data.category,
                    position: data.position,
                    sponsors1: data.sponsors1,
                    sponsors2: data.sponsors2,
                    sponsors3: data.sponsors3,
                    sponsors4: data.sponsors4,
                    sponsors5: data.sponsors5,
                    sponsors6: data.sponsors6,
                    sponsors7: data.sponsors7,
                    prize1: data.prize1,
                    prize2: data.prize2,
                    prize3: data.prize3,
                }
            }
            const result = await awards.updateOne(query, updatedData, options);

            if (result.matchedCount === 0 && result.upsertedCount === 0) {
                throw new Error('No document found or created');
            }
            res.send(result);
        })

        app.get('/awards', async (req, res) => {
            const data = await awards.find().toArray();
            res.send(data);
        })

        app.get('/awards/:category', async (req, res) => {
            const category = req.params.category
            console.log(category);
            const query = { category: { $eq: category } };
            const data = await awards.find(query).sort({ position: 1 }).toArray();
            res.send(data);
        })

        app.delete('/award/:id', async (req, res) => {
            const id = req.params.id;
            const result = await awards.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        })

        app.get('/faq', async (req, res) => {
            const data = await faq.find().toArray();
            res.send(data);
        })

        app.post('/faq', async (req, res) => {
            const data = req.body;
            const result = await faq.insertOne(data);
            res.send(result);
        })

        app.patch('/makeAdmin/:id', async (req, res) => {
            const id = req.params.id;
            const admin = req.body.admin;
            const query = { _id: new ObjectId(id) };
            const updatedData = {
                $set: {
                    admin: admin
                }
            }
            const resultedData = await usersCollection.updateOne(query, updatedData, { upsert: true });
            console.log(resultedData);
            res.send(resultedData);
        })

        app.patch('/removeAdmin/:id', async (req, res) => {
            const id = req.params.id;
            const admin = req.body.admin;
            const query = { _id: new ObjectId(id) };
            const updatedData = {
                $set: {
                    admin: admin
                }
            }
            const resultedData = await usersCollection.updateOne(query, updatedData, { upsert: true });
            console.log(resultedData);
            res.send(resultedData);
        })

        app.delete('/faq/:id', async (req, res) => {
            const id = req.params.id;
            const result = await faq.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        })

        app.patch('/targetedDate/67067fa3adad600b40fda96c', verify, verifyAdmin, async (req, res) => {
            const date = req.body;
            console.log(date);
            const query = { _id: new ObjectId('67067fa3adad600b40fda96c') };
            const result = await events.updateOne(query, {
                $set: {
                    date: date.date
                }
            }, { upsert: true });
            res.send(result);
        })

        app.patch('/targetedDate/6706bdd4a8317f059a67151a', verify, verifyAdmin, async (req, res) => {
            const date = req.body;
            console.log(date);
            const query = { _id: new ObjectId('6706bdd4a8317f059a67151a') };
            const result = await events.updateOne(query, {
                $set: {
                    date: date.date,
                    message: date.message
                }
            }, { upsert: true });
            res.send(result);
        })

        app.get('/targetedDate/67067fa3adad600b40fda96c', verify, verifyAdmin, async (req, res) => {
            const data = await events.findOne({ _id: new ObjectId('67067fa3adad600b40fda96c') })
            res.send(data);
        })

        app.get('/targetedDate/6706bdd4a8317f059a67151a', async (req, res) => {
            const data = await events.findOne({ _id: new ObjectId('6706bdd4a8317f059a67151a') })
            res.send(data);
        })

        app.patch('/changeCategory/:id', verify, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const data = req.body;
            const uid = data.uid;
            const updatedData = {
                $set: {
                    Wingfoil: data.Wingfoil,
                    Windfoil: data.Windfoil,
                    Downwind: data.Downwind,
                    Dockstart: data.Dockstart,
                    Surffoil: data.Surffoil,
                    Downwind: data.Downwind,
                    WatermanCrown: data.WatermanCrown
                }
            }
            const result = await usersCollection.updateOne(query, updatedData);
            res.send(result);
        })

        app.get('/getDetails/:uid', verify, verifyAdmin, async (req, res) => {
            const uid = req.params.uid;
            const data = await Promise.all([
                pointTable.findOne({ uid: uid }), GeoCollection.find({ uid: uid }).toArray()
            ]);
            console.log({
                pointTable: data[0],
                files: data[1]
            });

            res.send({
                pointTable: data[0],
                files: data[1]
            });
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
