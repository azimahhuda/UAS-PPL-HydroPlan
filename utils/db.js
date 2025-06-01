const { required } = require("joi");
const mongoose = require("mongoose");
const connect = mongoose.connect("mongodb://localhost:27017/hydroplan")

// check database connected or not
connect.then(() => {
    console.log("Database connected successfully!");
})
    .catch(() => {
        console.log("Database cannot be connected!");
    })

// Create a schema
const LoginSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    plants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Plant' }], // relasi plants

});

const logSchema = new mongoose.Schema({
    log: String,
    value: mongoose.Schema.Types.Mixed,
});

const stageSchema = new mongoose.Schema({
    name: String,
    duration: Number,
    logs: [logSchema],
    tips: [String],
});

const taskSchema = new mongoose.Schema({
    task: String,
    completed: Boolean,
});

const checklistSchema = new mongoose.Schema({
    day: Number,
    tasks: [taskSchema],
    photo: String,
});

const plantSchema = new mongoose.Schema({
    name: String,
    startDate: Date,
    description: String,
    image: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlantUser' },  // referensi user
    status: String,
    createdAt: { type: Date, default: Date.now },
    duration: Number,
    stages: [stageSchema],
    checklist: [checklistSchema],
});

const Plant = new mongoose.model('plants', plantSchema);
const Users = new mongoose.model("users", LoginSchema);

module.exports = { Plant, Users };