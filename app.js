const express = require("express");
const path = require("path");
const multer = require('multer');
const bcrypt = require("bcrypt");
const { Plant, Users } = require("./utils/db.js");
const expressLayouts = require("express-ejs-layouts");

const { body, validationResult, check } = require("express-validator");
const methodOverride = require("method-override");

const session = require("express-session");
const cookieParser = require("cookie-parser");
const flash = require("connect-flash");
const { constants } = require("zlib");

const MasterPlant = require("./data.json");

const fs = require('fs');

const app = express();
const port = 3000;

const ejs = require('ejs');
const { log } = require("console");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Session configuration
app.use(session({
  secret: 'hydroplan-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// Setup EJS
app.set("view engine", "ejs");

// app.use(expressLayouts);
app.use(express.static("public"));

// Konfigurasi flash
app.use(cookieParser("secret"));
app.use(
  session({
    cookie: { maxAge: 6000 },
    secret: "secret",
    resave: true,
    saveUninitialized: true,
  })
);

app.use(flash());
// Global variables for templates
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.user = req.session.user;
  next();
});

// Konfigurasi Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Batas ukuran 5MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Hanya file gambar yang diizinkan!'));
        }
        cb(null, true);
    }
});

app.get("/", (req, res) => {
  res.render("index", { title: "Beranda" });
});

app.get("/faq", (req, res) => {
  res.render("faq", { title: "FAQ" });
});

app.get("/register", (req, res) => {
  res.render("register", {
    title: "Daftar",
    messages: req.flash()
  });
});

// Daftar akun baru
app.post("/register", async (req, res) => {
  try {
    const data = {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      password: req.body.password,
    };

    // Cek apakah user sudah ada
    const existingUser = await Users.findOne({ email: data.email });
    if (existingUser) {
      req.flash("error", "Email sudah digunakan. Gunakan email lain!");
      return res.redirect("/register");
    }

    // Hash password
    const saltRounds = 10;
    data.password = await bcrypt.hash(data.password, saltRounds);

    // Simpan data ke database (cukup sekali)
    const userdata = await Users.insertOne(data);
    console.log("User registered:", userdata);

    // Flash + redirect
    req.flash("success", "Akun telah dibuat! Silakan login.");
    return res.redirect("/login");

  } catch (err) {
    console.error(err);
    req.flash("error", "Terjadi kesalahan. Silakan coba lagi.");
    return res.redirect("/register");
  }
});

app.get("/login", (req, res) => {
  res.render("login", {
    title: "Masuk",
    messages: req.flash()
  });
});

// Fungsi untuk menghitung hari
const calculateDayTimeline = (startDate) => {
    const start = new Date(startDate);
    const now = new Date();
    start.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    const diffTime = now - start;
    let diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    diffDays = Math.abs(diffDays); // Pastikan tidak negatif
    
    return diffDays < 1 ? 1 : diffDays;
};

// Route untuk dashboard
app.get("/dashboard", async (req, res) => {
    // Ensure user is logged in
    if (!req.session.user || !req.session.user._id) {
        return res.redirect('/login');
    }

    try {
        // Fetch plants for the logged-in user from MongoDB
        const activePlants = await Plant.find({ userId: req.session.user._id, status: 'active' }).lean();

        const plants = activePlants.map(plant => {
          const currentDay = calculateDayTimeline(plant.startDate);

            // Hitung timeline dari stages
            let cumulativeDays = 0;
            const timeline = (plant.stages || []).map((stage, index) => {
                const stageStartDay = cumulativeDays + 1;
                const stageEndDay = cumulativeDays + stage.duration;
                cumulativeDays += stage.duration;

                let status;
                if (currentDay > 1) {
                    status = 'upcoming';
                } else if (currentDay >= stageStartDay && currentDay <= stageEndDay) {
                    status = 'active';
                } else {
                    status = 'upcoming';
                }

                // Hitung startDate berdasarkan startDate tanaman
                const startDate = new Date(plant.startDate);
                startDate.setDate(startDate.getDate() + stageStartDay - 1);
                const formattedStartDate = startDate.toISOString().split('T')[0]; // Format YYYY-MM-DD

                return {
                    name: stage.name,
                    startDate: formattedStartDate,
                    status: status
                };
            });

            // Tentukan status tanaman
            let plantStatus = 'ongoing';
            let displayDay = currentDay;
            
            if (currentDay > 1) {
                plantStatus = 'upcoming';
                displayDay = null; // Tidak menampilkan hari jika belum mulai
            }

            return {
                _id: plant._id,
                name: plant.name,
                description: plant.description || '',
                image: plant.image,
                day: displayDay,
                totalDays: plant.duration,
                timeline: timeline,
                status: plantStatus,
            };
        });

        const today = new Date().getDate();

        const dailyTasks = activePlants.reduce((tasks, plant) => {
            const currentDay = calculateDayTimeline(plant.startDate);

            if (currentDay > 1) return tasks;

            const checklistForToday = plant.checklist?.find(entry => entry.day === currentDay);

            if (checklistForToday) {
                const plantTasks = checklistForToday.tasks.map(task => ({
                    task: task.task,
                    completed: task.completed
                }));

                tasks.push({
                    plant: plant.name,
                    tasks: plantTasks
                });
            }

            return tasks;
        }, []);

        // Render dashboard
        res.render('dashboard', {
            title: "Dashboard",
            plants,
            dailyTasks,
            user: req.session.user,
            currentMonth: 'May 2025',
            selectedDate: today
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).send('Server error');
    }
});

// Route tambah tanaman (form)
app.get('/tanaman/tambah', (req, res) => {
  res.render('formTambahTanaman', { title: "Tambah Tanaman" });
});

// Route proses tambah tanaman
app.post('/tanaman/tambah', async (req, res) => {
  try {
    const { jenisTanaman, tanggalMulai, catatan } = req.body;

    const userId = req.session.user._id;

    const plant = MasterPlant.find(plant => plant.name == jenisTanaman);

    if (!plant) {
      return res.status(400).json({ error: 'Tanaman tidak ditemukan dalam data master' });
    }

    const newPlant = new Plant({
      name: plant.name,
      startDate: new Date(tanggalMulai),
      description: catatan || plant.description || '',
      image: plant.image || '/images/default-plant.jpg',
      userId: userId,
      status: 'active',
      createdAt: new Date(),
      duration: plant.duration,
      stages: plant.stages,
      checklist: plant.checklist,
    });

    await newPlant.save();

    // Kalau ini untuk API, bisa kirim JSON sukses, contoh:
    res.status(201).json({ message: 'Tanaman berhasil ditambahkan', plant: newPlant });

    // Jika memang ingin redirect (misal untuk form submit dari browser), gunakan:
    // res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Gagal menambahkan tanaman' });
  }
});

// Route detail tanaman - Updated version
app.get('/tanaman/detail/:id', async (req, res) => {
  try {
    // Fetch plant by _id from MongoDB
    const tanaman = await Plant.findById(req.params.id).lean();

    if (!tanaman) {
      return res.render('detailTanaman', {
        title: "Detail Tanaman",
        tanaman: {
          name: 'Selada',
          description: '',
          image: '../img/default-plant.jpg',
          gallery: [],
          quote: '',
          tips: [],
          timeline: [],
          dailyTasks: [],
          logCurrent: [],
          logs: [],
          currentDay: 1,
          lastUpdated: new Date().toLocaleDateString('id-ID')
        }
      });
    }

    // Calculate current day (from startDate to May 31, 2025)
    const startDate = new Date(tanaman.startDate);
    const today = new Date('2025-05-31');
    const currentDay = Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const currentDayIndex = currentDay;

    // Prepare gallery dari checklist yang ada foto
    const gallery = tanaman.checklist
      .filter(dayChecklist => dayChecklist.photo && dayChecklist.photo !== '')
      .map(dayChecklist => ({
        url: dayChecklist.photo,
        day: dayChecklist.day || tanaman.checklist.indexOf(dayChecklist) + 1,
        date: new Date(startDate.getTime() +
          ((dayChecklist.day || tanaman.checklist.indexOf(dayChecklist)) - 1) * 24 * 60 * 60 * 1000)
          .toLocaleDateString('id-ID')
      }));

    // Find current stage
    let currentStage = null;
    let stageStartDay = 0;
    for (const stage of tanaman.stages) {
      const stageEndDay = stageStartDay + stage.duration;
      if (currentDay <= stageEndDay) {
        currentStage = stage;
        break;
      }
      stageStartDay += stage.duration;
    }

    // Prepare logCurrent (logs for current stage)
    const logCurrent = currentStage ? currentStage.logs.map((log, index) => ({
      stage: currentStage.name,
      log: log.log || 'Data Log',
      value: log.value || '',
      date: new Date(startDate.getTime() +
        (stageStartDay * 24 * 60 * 60 * 1000))
        .toLocaleDateString('id-ID'),
      index: index
    })) : [];

    // Prepare logs (all logs from all stages)
    let cumulativeDays = 0;
    const logs = tanaman.stages.reduce((allLogs, stage, stageIndex) => {
      const stageStartDate = new Date(startDate.getTime() +
        (cumulativeDays * 24 * 60 * 60 * 1000));
      cumulativeDays += stage.duration;

      const stageLogs = (stage.logs || []).map((log, logIndex) => ({
        stage: stage.name,
        log: log.log || 'Data Log',
        value: log.value || '',
        date: stageStartDate.toLocaleDateString('id-ID'),
        stageIndex: stageIndex,
        logIndex: logIndex
      }));

      return [...allLogs, ...stageLogs];
    }, []);

    // Prepare timeline
    cumulativeDays = 0;
    const timeline = tanaman.stages.map((stage, index) => {
      const stageStartDate = new Date(startDate.getTime() +
        (cumulativeDays * 24 * 60 * 60 * 1000));
      const stageEndDate = new Date(stageStartDate.getTime() +
        (stage.duration * 24 * 60 * 60 * 1000));

      const isCompleted = currentDay > cumulativeDays + stage.duration;
      const isActive = currentDay >= cumulativeDays + 1 && currentDay <= cumulativeDays + stage.duration;

      cumulativeDays += stage.duration;

      return {
        name: stage.name,
        duration: stage.duration,
        startDate: stageStartDate.toLocaleDateString('id-ID'),
        endDate: stageEndDate.toLocaleDateString('id-ID'),
        status: isCompleted ? 'completed' : (isActive ? 'active' : 'upcoming')
      };
    });

    // Prepare daily tasks untuk hari ini
    const dailyTasks = tanaman.checklist[currentDayIndex]?.tasks.map((task, index) => ({
      task: task.task,
      completed: task.completed,
      index: index
    })) || [];

    // Check if today's photo exists
    const todayPhotoExists = tanaman.checklist[currentDayIndex]?.photo &&
      tanaman.checklist[currentDayIndex].photo !== '';

    // Prepare tips (current stage)
    const tips = currentStage?.tips || [];

    // Prepare tanaman data
    const tanamanData = {
      _id: tanaman._id,
      name: tanaman.name,
      description: tanaman.description,
      image: tanaman.image,
      status: tanaman.status,
      gallery,
      quote: tanaman.description || 'Keep growing strong!',
      tips,
      timeline,
      dailyTasks,
      logCurrent,
      logs,
      currentDay,
      totalDays: tanaman.duration,
      todayPhotoExists,
      lastUpdated: tanaman.createdAt ? new Date(tanaman.createdAt).toLocaleDateString('id-ID') : new Date().toLocaleDateString('id-ID')
    };

    res.render('detailTanaman', {
      title: "Detail Tanaman",
      tanaman: tanamanData
    });
  } catch (error) {
    console.error('Error fetching plant details:', error);
    res.render('detailTanaman', {
      title: "Detail Tanaman",
      tanaman: {
        name: 'Selada',
        description: '',
        image: '../img/default-plant.jpg',
        gallery: [],
        quote: '',
        tips: [],
        timeline: [],
        dailyTasks: [],
        logCurrent: [],
        logs: [],
        currentDay: 1,
        lastUpdated: new Date().toLocaleDateString('id-ID')
      }
    });
  }
});

// Updated route for handling checklist 
app.put('/tanaman/detail/:id/checklist', async (req, res) => {
  try {
    // Ensure user is logged in
    if (!req.session.user || !req.session.user._id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Find the plant by _id
    const plant = await Plant.findById(req.params.id);
    if (!plant) {
      return res.status(404).json({ error: 'Plant not found' });
    }

    // Verify ownership
    if (plant.userId.toString() !== req.session.user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Calculate current day
    const startDate = new Date(plant.startDate);
    const today = new Date('2025-05-31');
    const currentDay = Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const currentDayIndex = currentDay;

    // Get task update from request body
    const { taskIndex, completed } = req.body;

    // Validate taskIndex
    let taskIdx = parseInt(taskIndex);
    if (isNaN(taskIdx) || taskIdx < 0) {
      return res.status(400).json({ error: 'Invalid task index' });
    }

    // Check if current day checklist exists
    if (!plant.checklist[currentDayIndex]) {
      return res.status(400).json({ error: 'Checklist for current day not found' });
    }

    // Check if task exists
    if (!plant.checklist[currentDayIndex].tasks[taskIdx]) {
      return res.status(400).json({ error: 'Task not found' });
    }

    // Update specific task
    const isCompleting = completed === 'true' || completed === true;
    plant.checklist[currentDayIndex].tasks[taskIdx].completed = isCompleting;

    // Update last modified timestamp
    plant.lastUpdated = new Date();

    // Save changes
    await plant.save();

    res.json({
      message: 'Checklist updated successfully',
      updatedTask: plant.checklist[currentDayIndex].tasks[taskIdx],
      success: true
    });

  } catch (error) {
    console.error('Error updating checklist:', error);
    res.status(500).json({
      error: error.message || 'Server error',
      success: false
    });
  }
});

const Timeline = (startDate) => {
    const start = new Date(startDate); // Konversi startDate ke objek Date
    const now = new Date(); // Tanggal saat ini
    // Atur waktu ke 00:00:00 untuk keduanya agar hanya membandingkan hari
    start.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    // Hitung selisih dalam milidetik
    const diffTime = now - start;
    // Konversi ke hari dan tambahkan 1 agar hari yang sama dihitung sebagai hari ke-1
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays < 1 ? 1 : diffDays; // Pastikan minimal hari ke-1
};

// Route untuk upload gambar
app.post('/tanaman/detail/:id/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Tidak ada file yang diunggah' });
        }

        const tanaman = await Plant.findById(req.params.id);
        if (!tanaman) {
            return res.status(404).json({ error: 'Tanaman tidak ditemukan' });
        }

        // Hitung hari saat ini
        const currentDay = Timeline(tanaman.startDate);

        // Cari atau buat checklist untuk hari ini
        let checklist = tanaman.checklist.find(check => check.day === currentDay);

        if (!checklist) {
            checklist = { day: currentDay, tasks: [], photo: "" };
            tanaman.checklist.push(checklist);
        }

        // Simpan URL gambar ke checklist.photo
        const imageUrl = `/uploads/${req.file.filename}`;
        
        checklist.photo = imageUrl;

        await tanaman.save();

        res.redirect(`/tanaman/detail/${tanaman._id}`); // Redirect ke halaman detail tanaman
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message || 'Gagal mengunggah gambar' });
    }
});

// Route untuk update log perkembangan
app.put('/tanaman/detail/:id/log', async (req, res) => {
  try {
    // Ensure user is logged in
    if (!req.session.user || !req.session.user._id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Find the plant by _id
    const plant = await Plant.findById(req.params.id);
    if (!plant) {
      return res.status(404).json({ error: 'Plant not found' });
    }

    // Verify ownership
    if (plant.userId.toString() !== req.session.user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Prevent updates if plant is completed
    if (plant.status === 'completed') {
      return res.status(400).json({ error: 'Cannot update logs for a completed plant' });
    }

    // Calculate current day and current stage
    const startDate = new Date(plant.startDate);
    const today = new Date('2025-05-31');
    const currentDay = Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // Find current stage
    let currentStage = null;
    let stageIndex = -1;
    let stageStartDay = 0;

    for (let i = 0; i < plant.stages.length; i++) {
      const stage = plant.stages[i];
      const stageEndDay = stageStartDay + stage.duration;
      if (currentDay <= stageEndDay) {
        currentStage = stage;
        stageIndex = i;
        break;
      }
      stageStartDay += stage.duration;
    }

    if (!currentStage) {
      return res.status(400).json({ error: 'Current stage not found' });
    }

    // Get log update from request body
    const { stageIndex: stageIdx, logIndex, value } = req.body;

    // Validate stageIndex
    const stageIndexNum = parseInt(stageIdx);
    if (isNaN(stageIndexNum) || stageIndexNum !== stageIndex) {
      return res.status(400).json({ error: 'Invalid stage index' });
    }

    // Validate logIndex
    const logIdx = parseInt(logIndex);
    if (isNaN(logIdx) || logIdx < 0) {
      return res.status(400).json({ error: 'Invalid log index' });
    }

    // Check if updating existing log or creating new one
    if (logIdx < plant.stages[stageIndex].logs.length) {
      // Update existing log
      if (!plant.stages[stageIndex].logs[logIdx]) {
        return res.status(400).json({ error: 'Log not found' });
      }
      plant.stages[stageIndex].logs[logIdx].value = value || '';
      plant.stages[stageIndex].logs[logIdx].lastUpdated = new Date();
    } else {
      // Create new log
      if (!log) {
        return res.status(400).json({ error: 'Log name is required for new log' });
      }
      // Ensure logIdx is sequential
      if (logIdx > plant.stages[stageIndex].logs.length) {
        return res.status(400).json({ error: 'Log index must be sequential' });
      }
      plant.stages[stageIndex].logs.push({
        log: log,
        value: value || '',
        lastUpdated: new Date()
      });
    }

    // Update plant last modified timestamp
    plant.lastUpdated = new Date();

    // Save changes
    await plant.save();

    res.json({
      message: 'Log berhasil diperbarui atau ditambahkan',
      updatedLog: plant.stages[stageIndex].logs[logIdx],
      success: true
    });
  } catch (error) {
    console.error('Error updating/adding log:', error);
    res.status(500).json({
      error: error.message || 'Server error',
      success: false
    });
  }
});

app.put('/tanaman/detail/:id/complete', async (req, res) => {
  try {
    // Ensure user is logged in
    if (!req.session.user || !req.session.user._id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Find the plant by _id
    const plant = await Plant.findOne({ _id: req.params.id, userId: req.session.user._id });
    if (!plant) {
      return res.status(404).json({ error: 'Plant not found or not authorized' });
    }

    // Check if plant is already completed
    if (plant.status === 'completed') {
      return res.status(400).json({ error: 'Plant is already completed' });
    }

    // Update status to completed
    plant.status = 'completed';
    plant.lastUpdated = new Date();

    // Save changes
    await plant.save();

    res.status(200).json({ message: 'Plant marked as completed' });
  } catch (error) {
    console.error('Error completing plant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
app.post("/login", async (req, res) => {
  try {
    const check = await Users.findOne({ email: req.body.email });
    if (!check) {
      req.flash("error", "email cannot found");
      return res.redirect("/login");
    }

    const isPasswordMatch = await bcrypt.compare(
      req.body.password,
      check.password
    );
    if (isPasswordMatch) {
      req.session.user = check; // Simpan seluruh objek pengguna ke sesi
      req.session.isAuth = true;
      return res.redirect("/dashboard");

    } else {
      req.flash("error", "wrong password!");
      return res.redirect("/login");
    }
  } catch {
    req.flash("error", "wrong details!");
    return res.redirect("/login");
  }
});

app.get('/history', async (req, res) => {
  try {
    // Ensure user is logged in
    if (!req.session.user || !req.session.user._id) {
      return res.redirect('/login');
    }

    // Fetch plants with status 'completed' for the logged-in user
    const plants = await Plant.find({
      userId: req.session.user._id,
      status: 'completed'
    }).lean();

    // Map plants to include necessary data
    const formattedPlants = plants.map(plant => ({
      _id: plant._id,
      name: plant.name,
      description: plant.description || '',
      image: plant.image || '/images/default-plant.jpg',
      startDate: new Date(plant.startDate).toLocaleDateString('id-ID'),
      duration: plant.duration,
      status: plant.status
    }));

    res.render('history', {
        title: "History",
        plants: formattedPlants,
    });
  } catch (error) {
    console.error('Error fetching history plants:', error);
    res.render('history', {
      title: 'Histori Tanaman',
      plants: [],
      error: 'Gagal memuat histori tanaman'
    });
  }
});

app.get('/settings', (req, res) => {
  res.render('settings');
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.log(err);
    }
    res.redirect('/');
  });
});

app.listen(port, () => {
  console.log(`App is running at http://localhost:${port}`);
});
