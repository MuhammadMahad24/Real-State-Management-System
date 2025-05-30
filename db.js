const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "22ntucs1201",  // ✅ your actual password
  database: "real_state"   // ✅ replace with your actual database name
});

db.connect(err => {
  if (err) {
    console.error("DB Connection Failed:", err);
  } else {
    console.log("MySQL Connected...");
  }
});

module.exports = db;
