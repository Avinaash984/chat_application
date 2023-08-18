const express = require('express');     // allows us to respond to http request
const session = require('express-session');  //stores user specific data
const mongoose = require('mongoose');   // mongoose being brought up
const bcrypt = require('bcrypt');       // for hashed passwords
const path = require('path');           // makes it easier to work with directories
const http = require('http');           // creates http server
const socketIo = require('socket.io');  // for chatting



const app = express();   
const server = http.createServer(app);   //creates http server object and returns it
const io = socketIo(server);      



app.set('view engine', 'ejs');      // we are setting up ejs as our view enginne
                                    //view engine is place to write html codes


//middleware: handles http request and sends response
app.use(express.urlencoded({ extended: true }));  //use: sets up middleware in express
                                                  //express package-incomin reuest to url encoded

app.use(session({
    secret: '101705',        //adds a layer of security
    resave: false,           //determines whether session to be saved
    saveUninitialized: true  //new sessions are saved
}));

app.use(express.static(path.join(__dirname, 'public')));   //static files from public directory is joined to current directory



//CONNECTING MONGODB
mongoose.connect('mongodb://127.0.0.1/group'/*, {useNewUrlParser: true, useUnifiedTopology: true }*/)
    //ASYNCHRONOUS OPERATION
    .then(() => {
        console.log('Connected to MongoDB');  //a chain used to ensure success of operation
    })
    .catch(err => {
        console.error('MongoDB connection error:', err);  //same that is to ensure 
    });


const UserSchema = new mongoose.Schema({
    name: String,
    username: String,
    password: String
});

const User = mongoose.model('User', UserSchema);  //provides method to manipulating documents
                                                  //automatically adds a s in user= users (models name)


const GroupSchema = new mongoose.Schema({
    name: String,
    purpose: String,
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],  //array
              //Used as unique identifier for documents      it is in ref to User
    created_at: { type: Date, default: Date.now },
    chatHistory: [{ sender: String, message: String, timestamp: { type: Date, default: Date.now } }]
});   //array               //creates object with three informations 

const Group = mongoose.model('Group', GroupSchema);

// Routes
app.get('/', (req, res) => {
    if (req.session.user) {
        res.render('home', { user: req.session.user });
        console.log(req.session)
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('login.ejs');
});

app.post('/login', async (req, res) => {
    try {
        const { name, username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            throw new Error('Invalid username or password');
        }
        req.session.user = user;
        res.redirect('/');
    } catch (error) {
        res.render('login', { error: 'Invalid username or password' });
    }
});

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {
    try {
        const { name, username, password, confirmPassword } = req.body;

        if (password !== confirmPassword) {
            throw new Error('Passwords do not match');
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            throw new Error('Username already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            name,
            username,
            password: hashedPassword
        });

        await newUser.save();
        res.redirect('/login');
    } catch (error) {
        res.render('register', { error: error.message });
    }
});

app.get('/create-group', (req, res) => {
    res.render('create-group');
});

app.post('/create-group', async (req, res) => {
    try {
        const { name, purpose } = req.body;

        const newGroup = new Group({
            name,
            purpose,
            members: [req.session.user._id]
        });

        await newGroup.save();
        res.redirect('/dashboard');
    } catch (error) {
        res.render('create-group', { error: 'Error creating group' });
    }
});

app.get('/dashboard', async (req, res) => {
    try {
        const user = req.session.user;
        const groups = await Group.find().populate('members').exec();

        res.render('dashboard', { user, groups });
    } catch (error) {
        res.render('dashboard', { user: req.session.user, groups: [], error: 'Error fetching groups' });
    }
});

app.post('/join-group', async (req, res) => {
    try {
        const group = await Group.findById(req.body.group_id);

        if (!group) {
            throw new Error('Group not found');
        }

        if (!group.members.includes(req.session.user._id)) {
            group.members.push(req.session.user._id);
            await group.save();
        }

        res.redirect('/dashboard');
    } catch (error) {
        res.render('dashboard', { user: req.session.user, error: 'Error joining group' });
    }
});

app.get('/group/:id', async (req, res) => {
    try {
        const group = await Group.findById(req.params.id).populate('members').exec();

        if (!group) {
            return res.redirect('/dashboard');
        }

        res.render('group', { group });
    } catch (error) {
        res.render('dashboard', { user: req.session.user, error: 'Error fetching group' });
    }
});

app.post('/search-groups', async (req, res) => {
    const { searchQuery } = req.body;

    const groups = await Group.find({
        $or: [
            { name: { $regex: searchQuery, $options: 'i' } },
            { purpose: { $regex: searchQuery, $options: 'i' } }
        ]
    }).populate('members').exec();

    res.render('dashboard', { user: req.session.user, groups });
});

app.get('/logout', (req, res) => {
    res.redirect('/login');
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-group', (groupId) => {
        socket.join(groupId);
        console.log(`User ${socket.id} joined group ${groupId}`);
    });

    socket.on('send-message', async (data) => {
        try {
            const { groupId, message } = data;
            const group = await Group.findById(groupId);

            if (!group) {
                throw new Error('Group not found');
            }

            group.chatHistory.push({ sender: socket.id, message });
            await group.save();
            //const senderUser = await User.findById(socket.id);
            io.to(groupId).emit('receive-message', { message, sender: socket.id });
        } catch (error) {
            console.error('Error sending message:', error);
        }
    });
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

server.listen(3000, () => {
    console.log('Server is running on port 3000');
});
