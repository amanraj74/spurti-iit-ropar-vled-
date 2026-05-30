import mongoose from 'mongoose';

const investmentSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectInvestmentEvent', required: true },
  // Who invested
  investorTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  investorTeamName: { type: String, required: true },
  investorLeaderEmail: { type: String, required: true },
  // What they invested in
  targetProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamProject', required: true },
  targetTeamName: { type: String, required: true },
  targetProjectName: { type: String, required: true },
  // Amount
  amount: { type: Number, required: true },
  comment: { type: String, required: true, maxlength: 1000 }
}, { timestamps: true });

investmentSchema.index({ eventId: 1, investorTeamId: 1 });
investmentSchema.index({ eventId: 1, targetProjectId: 1 });

export default mongoose.model('Investment', investmentSchema);
