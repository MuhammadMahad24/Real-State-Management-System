const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs'); // Import fs for directory check
const db = require('./db'); // Make sure this exports your MySQL connection pool or connection

const app = express();
const PORT = process.env.PORT || 3000; // Use environment variable for port
const SECRET_KEY = process.env.JWT_SECRET || 'your_secret_key_here'; // Use env var in production for JWT secret

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
// Serve uploaded files from the 'uploads' directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    console.log(`Creating uploads directory: ${uploadDir}`);
    fs.mkdirSync(uploadDir);
}

// Multer config for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // console.log(`Attempting to save file to: ${uploadDir}`); // Debugging Multer
        cb(null, uploadDir); // Ensure this path is correct and writable
    },
    filename: (req, file, cb) => {
        // Clean filename and prepend timestamp for uniqueness
        const cleanedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase(); // Sanitize filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${fileExtension}`); // Use fieldname for clarity
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
    fileFilter: (req, file, cb) => {
        // Accept images and videos only
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images and videos are allowed!'), false);
        }
    }
});

// ---------------------- Auth APIs ----------------------

// Register API
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required for registration.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.query(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword],
            (err, result) => {
                if (err) {
                    console.error('Registration error:', err);
                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.status(409).json({ message: 'Email already exists. Please use a different email.' });
                    }
                    return res.status(500).json({ message: 'Server error during registration. Please try again.' });
                }
                res.status(201).json({ message: 'User registered successfully!' });
            }
        );
    } catch (err) {
        console.error('Error hashing password:', err);
        res.status(500).json({ message: 'Internal server error during registration.' });
    }
});

// Login API
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required for login.' });
    }

    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err) {
            console.error('Login DB query error:', err);
            return res.status(500).json({ message: 'Database error during login.' });
        }

        if (results.length === 0) {
            return res.status(401).json({ message: 'Invalid email or user not found.' });
        }

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Incorrect password.' });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '1h' }); // Token expires in 1 hour
        res.json({
            message: 'Login successful',
            token,
            user: { id: user.id, email: user.email, name: user.name }
        });
    });
});

// ---------------------- Property APIs ----------------------

// Upload property (with image/video)
app.post('/api/properties', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), (req, res) => {
    const { title, location, price, description, ownerId } = req.body;

    // Input validation
    if (!title || !location || !price || !ownerId) {
        return res.status(400).json({ message: 'Title, location, price, and owner ID are required.' });
    }

    // Get filenames from Multer
    const image = req.files && req.files['image'] && req.files['image'][0] ? req.files['image'][0].filename : null;
    const video = req.files && req.files['video'] && req.files['video'][0] ? req.files['video'][0].filename : null;

    console.log('Attempting to add property with data:', { title, location, price, description, ownerId, image, video });

    const sql = 'INSERT INTO properties (title, location, price, description, image_url, video_url, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [title, location, price, description, image, video, ownerId], (err, result) => {
        if (err) {
            console.error('DB Insert Error:', err);
            let errorMessage = 'Error inserting property into database.';
            if (err.code === 'ER_NO_REFERENCED_ROW_2') {
                errorMessage = 'Owner ID not found or invalid. Please ensure you are logged in.';
            } else if (err.sqlMessage) {
                // Use err.sqlMessage for more specific MySQL errors
                errorMessage = `Database Error: ${err.sqlMessage}`;
            }
            return res.status(500).json({ message: errorMessage, error: err.message });
        }
        res.status(201).json({ message: 'Property added successfully!' }); // 201 Created for successful creation
    });
});

// Get properties by ownerId
app.get('/api/properties', (req, res) => {
    const { ownerId } = req.query;

    if (!ownerId) {
        return res.status(400).json({ message: 'Owner ID is required to fetch properties.' });
    }

    db.query('SELECT * FROM properties WHERE owner_id = ?', [ownerId], (err, results) => {
        if (err) {
            console.error('DB Fetch Error for owner properties:', err);
            return res.status(500).json({ message: 'Error fetching properties.', error: err.message });
        }
        res.json(results);
    });
});

// GET all properties (for properties.html - if you have one)
// If you have a separate properties.html to view all listings,
// you might need an endpoint like this. If not, ignore or adapt.
app.get('/api/all-properties', (req, res) => {
    db.query('SELECT p.*, u.name as owner_name, u.email as owner_email FROM properties p JOIN users u ON p.owner_id = u.id', (err, results) => {
        if (err) {
            console.error('DB Fetch Error for all properties:', err);
            return res.status(500).json({ message: 'Error fetching all properties.', error: err.message });
        }
        res.json(results);
    });
});


// Delete property by ID
app.delete('/api/properties/:id', (req, res) => {
    const { id } = req.params;

    // Optional: Add authentication/authorization here to ensure
    // only the owner or an admin can delete the property.
    // E.g., check req.user.id against property.owner_id before deleting.

    db.query('DELETE FROM properties WHERE id = ?', [id], (err, result) => {
        if (err) {
            console.error('DB Delete Error:', err);
            return res.status(500).json({ message: 'Error deleting property.', error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Property not found or already deleted.' });
        }
        res.json({ message: 'Property deleted successfully!' });
    });
});


// ---------------------- Server Start ----------------------
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Uploads directory: ${uploadDir}`);
    // You might want to log the JWT secret in development, but not production
    // console.log(`JWT_SECRET: ${SECRET_KEY}`);
});
