import * as XLSX from 'xlsx';
import { Trade, TradingSession, SessionStats } from '../types';

export const exportToJSON = (session: TradingSession, trades: Trade[], stats: SessionStats) => {
  const exportData = {
    session: {
      name: session.name,
      initial_capital: session.initial_capital,
      current_capital: session.current_capital,
      created_at: session.created_at,
    },
    trades: trades.map(trade => ({
      margin: trade.margin,
      roi: trade.roi,
      entry_side: trade.entry_side,
      profit_loss: trade.profit_loss,
      comments: trade.comments,
      created_at: trade.created_at,
    })),
    statistics: stats,
  };

  const dataStr = JSON.stringify(exportData, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  
  const exportFileDefaultName = `${session.name.replace(/\s+/g, '_')}_trading_session.json`;
  
  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
};

export const exportToExcel = (session: TradingSession, trades: Trade[], stats: SessionStats) => {
  const wb = XLSX.utils.book_new();
  
  // Session Summary Sheet
  const summaryData = [
    ['Session Name', session.name],
    ['Session Type', session.session_type || 'Forex'],
    ['Initial Capital', session.initial_capital],
    ['Current Capital', session.current_capital],
    ['Net P/L', stats.netProfitLoss],
    ['Net P/L %', stats.netProfitLossPercentage],
    ['Total Trades', stats.totalTrades],
    ['Win Rate %', stats.winRate],
    ['Winning Trades', stats.winningTrades],
    ['Losing Trades', stats.losingTrades],
    ['Total Margin Used', stats.totalMarginUsed],
    ['Average ROI %', stats.averageROI],
  ];
  
  const summaryWS = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');
  
  // Enhanced Trades Sheet with all detailed fields
  const tradesData = [
    [
      'Date',
      'Symbol',
      'Type', 
      'Volume (Lot)',
      'Open Price',
      'Close Price',
      'Leverage',
      'Take Profit (TP)',
      'Stop Loss (SL)',
      'Position',
      'Close Reason',
      'Open Time',
      'Close Time',
      'P&L (USD)',
      'Margin (USD)',
      'Entry Side',
      'ROI %',
      'Comments',
      // Crypto specific fields
      'Futures Symbol',
      'Margin Mode',
      'Avg Entry Price',
      'Avg Close Price',
      'Direction',
      'Closing Quantity',
      'Realized PNL',
      'Margin Adjustment History'
    ]
  ];
  
  trades.forEach(trade => {
    const formatDateTime = (dateTime: string | undefined) => {
      if (!dateTime) return '';
      try {
        return new Date(dateTime).toLocaleString();
      } catch {
        return dateTime;
      }
    };

    const formatNumber = (num: number | undefined) => {
      return num !== undefined && num !== null ? num : '';
    };

    tradesData.push([
      new Date(trade.created_at).toLocaleDateString(),
      trade.symbol || trade.futures_symbol || '', // Symbol (Forex) or Futures Symbol (Crypto)
      trade.type || (trade.direction === 'Long' ? 'Buy' : trade.direction === 'Short' ? 'Sell' : ''), // Type
      formatNumber(trade.volume_lot || trade.closing_quantity), // Volume (Lot) or Closing Quantity
      formatNumber(trade.open_price || trade.avg_entry_price), // Open Price or Avg Entry Price
      formatNumber(trade.close_price || trade.avg_close_price), // Close Price or Avg Close Price
      formatNumber(trade.leverage), // Leverage
      formatNumber(trade.tp), // Take Profit (TP)
      formatNumber(trade.sl), // Stop Loss (SL)
      trade.position || '', // Position
      trade.reason || '', // Close Reason
      formatDateTime(trade.open_time), // Open Time
      formatDateTime(trade.close_time), // Close Time
      formatNumber(trade.profit_loss || trade.realized_pnl), // P&L (USD) or Realized PNL
      formatNumber(trade.margin), // Margin (USD)
      trade.entry_side || trade.direction || '', // Entry Side or Direction
      formatNumber(trade.roi), // ROI %
      trade.comments || '', // Comments
      // Crypto specific fields
      trade.futures_symbol || '', // Futures Symbol
      trade.margin_mode || '', // Margin Mode
      formatNumber(trade.avg_entry_price), // Avg Entry Price
      formatNumber(trade.avg_close_price), // Avg Close Price
      trade.direction || '', // Direction
      formatNumber(trade.closing_quantity), // Closing Quantity
      formatNumber(trade.realized_pnl), // Realized PNL
      trade.margin_adjustment_history || '' // Margin Adjustment History
    ]);
  });
  
  const tradesWS = XLSX.utils.aoa_to_sheet(tradesData);
  
  // Set column widths for better readability
  const colWidths = [
    { wch: 12 }, // Date
    { wch: 15 }, // Symbol
    { wch: 8 },  // Type
    { wch: 12 }, // Volume (Lot)
    { wch: 12 }, // Open Price
    { wch: 12 }, // Close Price
    { wch: 10 }, // Leverage
    { wch: 12 }, // Take Profit (TP)
    { wch: 12 }, // Stop Loss (SL)
    { wch: 10 }, // Position
    { wch: 12 }, // Close Reason
    { wch: 18 }, // Open Time
    { wch: 18 }, // Close Time
    { wch: 12 }, // P&L (USD)
    { wch: 12 }, // Margin (USD)
    { wch: 12 }, // Entry Side
    { wch: 10 }, // ROI %
    { wch: 30 }, // Comments
    { wch: 15 }, // Futures Symbol
    { wch: 12 }, // Margin Mode
    { wch: 15 }, // Avg Entry Price
    { wch: 15 }, // Avg Close Price
    { wch: 10 }, // Direction
    { wch: 15 }, // Closing Quantity
    { wch: 12 }, // Realized PNL
    { wch: 25 }  // Margin Adjustment History
  ];
  
  tradesWS['!cols'] = colWidths;
  
  XLSX.utils.book_append_sheet(wb, tradesWS, 'Detailed Trades');
  
  XLSX.writeFile(wb, `${session.name.replace(/\s+/g, '_')}_detailed_trading_session.xlsx`);
};

export const importFromJSON = (file: File): Promise<any> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        resolve(json);
      } catch (error) {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
};