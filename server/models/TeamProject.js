import mongoose from 'mongoose';

const teamProjectSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectInvestmentEvent', required: true },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  teamName: { type: String, required: true },
  projectName: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  createdByEmail: { type: String },
  // Computed (updated on each new investment)
  totalInvestmentReceived: { type: Number, default: 0 },
  investorCount: { type: Number, default: 0 }
}, { timestamps: true });

teamProjectSchema.index({ eventId: 1, teamId: 1 }, { unique: true });
teamProjectSchema.index({ eventId: 1 });

export default mongoose.model('TeamProject', teamProjectSchema);
