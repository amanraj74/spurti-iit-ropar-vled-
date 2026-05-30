import mongoose from 'mongoose';

const teamWalletSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectInvestmentEvent', required: true },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  teamName: { type: String, required: true },
  totalVC: { type: Number, required: true, default: 0 },
  investedVC: { type: Number, default: 0 }
}, {
  timestamps: true,
  // computed: availableVC = totalVC - investedVC
});

teamWalletSchema.index({ eventId: 1, teamId: 1 }, { unique: true });
teamWalletSchema.index({ eventId: 1 });

// Virtual for available VC
teamWalletSchema.virtual('availableVC').get(function () {
  return this.totalVC - this.investedVC;
});

// Ensure virtuals are included in JSON
teamWalletSchema.set('toJSON', { virtuals: true });
teamWalletSchema.set('toObject', { virtuals: true });

export default mongoose.model('TeamWallet', teamWalletSchema);
