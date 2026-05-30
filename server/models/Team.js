import mongoose from 'mongoose';

const teamMemberSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  email: { type: String, required: true },
  name: { type: String, required: true },
  isLeader: { type: Boolean, default: false }
}, { _id: false });

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
  members: [teamMemberSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

teamSchema.index({ 'members.email': 1 });

export default mongoose.model('Team', teamSchema);
