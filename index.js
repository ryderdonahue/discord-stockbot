/* TODO 
  Add charts: 
    // https://www.google.com/finance/chart?cht=g&q=NASDAQ:AMZN&tkr=1&p=1d&enddatetime=2017-07-07T16:00:03Z
  Add portfolio [user]
  Add daily leaderboard post
  Add crypto trading
  Add historical leaderboard tracking
*/


var convert = require('xml-js');
var http = require('http');
const Discord = require('discord.js');
var fetch = require('node-fetch');
const client = new Discord.Client();
var botKey = require('./botkey');
var storage = require('node-persist');

var users = {};
var market = {};
var myChannel = null;
var myChannelId = undefined;
var marketMonitorRate = 1800000;
var orders = [];
var version = 1;
/* ORDER
  userId:
  symbol:
  amount:
  price:
  type:
  action:
  timestamp:
  orderId: 
*/

function setItem(key, value) {
  storage.setItem(key, value);
}


storage.initSync();


var values = storage.values();
storage.getItem('version', async function (err, value) {
  if (value === undefined) {
    console.log("NEW BOT OR FILE FAULT, NO USERS FILE DETECTED. CREATING...");
    await storage.setItem("users", users);
    await storage.setItem("market", market);
    await storage.setItem("myChannelId", myChannelId);
    await storage.setItem("orders", orders);
    await storage.setItem("marketMonitorRate", marketMonitorRate);
    await storage.setItem("version", version);
  } else {
    console.log("PREVIOUS ");
    version = value;
    users = await storage.getItem("users");
    market = await storage.getItem("market");
    myChannelId = await storage.getItem("myChannelId");
    orders = await storage.getItem("orders");
    marketMonitorRate = await storage.getItem("marketMonitorRate");
  }
}).then(() => {

  client.on('ready', () => {
    console.log(botKey.apiKey());
    setInterval(processMarket, marketMonitorRate);

    if (myChannelId !== undefined) {
      client.channels.forEach(channel => {
        if (channel.id == myChannelId) {
          myChannel = channel;
        }
      });
    }
  });

  client.on('message', async function (message) {
    if (message.content.startsWith("#monitor channel")) {
      myChannel = message.channel;
      setItem('myChannelId', myChannel.id);

      myChannel.sendMessage("Monitoring #" + message.channel.name);
      myChannel.sendMessage(printCommands());
    }

    if (message.content.startsWith("#help")) {
      myChannel.sendMessage(printCommands());
    }

    if (message.content.startsWith("#cash")) {
      if (users[message.author.tag]) {
        var user = users[message.author.tag];
        message.reply('Cash: $' + user.cash.toFixed(2))
      }
    }

    if (message.content.startsWith("#quote")) {
      try {
        var stock = message.content.slice(6, message.content.length).trim().toUpperCase();

        // Crypto        
        if (stock === 'ETH' || stock === 'BTC' || stock === 'LTC') {
          var crypto = await RetrieveWebStock(stock);
          if (crypto) {
            message.channel.send(formatCryptoQuote(crypto, stock));
          }
          else {
            message.channel.send("something went wrong :\\");
          }
        }
        // Stock
        else {
          if (stock.length >= 1 && stock.length <= 10) {
            var options = {
              host: 'ws.cdyne.com',
              port: 80,
              path: '/delayedstockquote/delayedstockquote.asmx/GetQuote?StockSymbol=' + stock.trim() + '&LicenseKey=0'
            };

            http.get(options, function (resp) {
              resp.setEncoding('utf8');

              resp.on('data', function (chunk) {
                try {
                  var result1 = convert.xml2js(chunk, {
                    compact: true,
                    spaces: 4
                  });
                  message.channel.send(formatQuote(result1.QuoteData));
                } catch (e) {
                  message.channel.send("something went wrong :\\");
                }
              });
            }).on("error", function (e) {
              console.log("Got error: " + e.message);
            });
          } else {
            message.channel.send("invalid stock symbol");
          }
        }
      } catch (e) {
        message.channel.send("something went wrong :\\");
      }
    }

    if (message.content.startsWith("#register")) {
      registerUser(message.author.tag, message);
    }

    if (message.content.startsWith("#buy")) {
      var command = message.content.slice(4, message.content.length).trim();
      var params = command.split(' ');
      var user = users[message.author.tag];
      if (user && (params[0].length >= 1 && params[0].length <= 10) && !isNaN(params[1])) {
        var amt = Number(params[1]);
        var stock = await getStock(params[0].toUpperCase());
        if (stock) {
          buyStock(user, stock, amt)
          setItem('users', users);
        }
      }
    }

    if (message.content.startsWith("#sell")) {
      var command = message.content.slice(5, message.content.length).trim();
      var params = command.split(' ');
      var user = users[message.author.tag];
      if (user && (params[0].length >= 1 && params[0].length <= 10) && !isNaN(params[1])) {
        var stock = await getStock(params[0].toUpperCase());
        var amt = Number(params[1]);
        if (stock) {
          sellStock(user, stock, amt);
          setItem('users', users);
        }
      }
    }

    if (message.content.startsWith("#reset costbasis")) {
      var user = users[message.author.tag];
      if (user) {
        resetCostBasis(user);
        message.reply("**RESET**");
      }
    }

    if (message.content.startsWith("#leaderboard")) {
      printLeaderboard();
    }

    if (message.content.startsWith("#list orders")) {
      var output = '';
      for (let i = 0; i < orders.length; i++) {
        let order = orders[i];
        if (order.userId == message.author.tag) {
          output += printOrder(order);
        }
      }

      if (output.length > 0) {
        message.reply(' **ORDERS:**\n' + output);
      } else {
        message.reply(' has no pending orders.');
      }
    }

    if (message.content.startsWith("#delete order")) {
      var command = message.content.slice(13, message.content.length).trim();
      var orderFound = false;
      for (let i = 0; i < orders.length; i++) {
        let order = orders[i];
        if (order.orderId == command) {
          if (order.userId == message.author.tag) {
            message.reply("**Order Deleted:**\n" + printOrder(order));
            orders.splice(i, 1);
            setItem('orders', orders);
            orderFound = true;
            break;
          } else {
            message.reply(" you are not the owner of this order!");
          }
        }
      }

      if (!orderFound) {
        message.reply(" no order under that ID found");
      }
    }

    if (message.content.startsWith("#limit order") || message.content.startsWith("#stop order")) {
      var command = message.content.slice(message.content.startsWith("#stop") ? 11 : 12, message.content.length).trim();
      var params = command.split(' ');
      var user = users[message.author.tag];
      if (user &&
        (params[0].toUpperCase() == "BUY" || params[0].toUpperCase() == "SELL") &&
        (params[1].length >= 1 && params[1].length <= 10) &&
        !isNaN(params[2]) &&
        !isNaN(params[3])) {
        var orderType = params[0].toUpperCase();
        var stock = await getStock(params[1].toUpperCase());
        if (stock) {
          var amt = Number(params[2]);
          var orderPrice = Number(params[3]);
          var orderId = guid();
          orders.push({
            userId: message.author.tag,
            symbol: stock.Symbol,
            amount: amt,
            price: orderPrice,
            action: orderType,
            type: message.content.startsWith("#stop") ? "stop" : "limit",
            timestamp: Date(),
            orderId: orderId
          })

          message.reply(
            '```' +
            (message.content.startsWith("#stop") ? "stop order placed:\n" : "limit order placed:\n") +
            orderType + ' ' + amt + ' share(s) of ' + stock.Symbol + ' at $' + orderPrice + '\nOrderId: ' + orderId + '```')

          setItem('orders', orders);
        }
      }
    }

    if (message.content.startsWith('#portfolio')) {
      if (users[message.author.tag]) {
        let summary = await getSummary(message.author.tag);
        message.reply("**Portfolio:**\n" + summary);
      }
    }

    console.log(message.content);
  });
});

function printOrder(order) {
  return '```' + order.type + ' ' + order.amount + ' share(s) of' + order.symbol + ' at $' + order.price + '\nOrderId: ' + order.orderId + '```';
}

async function getStock(symbol) {
  var stock;
  if (market[symbol]) {
    var dateDiff = new Date(market[symbol].LastUpdated) - new Date();
    if (dateDiff < -300000) {
      //refreshing stock
      stock = await RetrieveWebStock(symbol)
      market[stock.Symbol] = stock;
      setItem('market', market);
    } else {
      stock = market[symbol];
    }
  } else {
    stock = await RetrieveWebStock(symbol);
    market[stock.Symbol] = stock;
    setItem('market', market);
  }

  return stock;
}

async function RetrieveWebStock(symbol) {
  // TODO: Put this into it's own codepath so it doesn't block trading these stock symbols
  var symbolName = symbol.toUpperCase();
  if (symbolName === 'ETH' || symbolName === 'BTC' || symbolName === 'LTC') {
    const response = await fetch('https://api.gdax.com/products/' + symbol + '-USD/ticker');
    const text = await response.text();
    const jsonResponse = JSON.parse(text);
    return ConvertGdaxQuote(jsonResponse, symbol);
  }
  else if (market[symbol]) {
    var stock = null;
    const resp2 = await fetch('https://finance.google.com/finance/info?q=' + symbol);
    let body2 = await resp2.text();
    body2 = body2.slice(4);
    let jsonResponse = JSON.parse(body2);
    return UpdateStock(jsonResponse[0], market[symbol]);
  } else {
    const response = await fetch('http://ws.cdyne.com/delayedstockquote/delayedstockquote.asmx/GetQuote?StockSymbol=' + symbol + '&LicenseKey=0');
    let body = await response.text();
    var xmlBody = convert.xml2js(body, {
      compact: true,
      spaces: 4
    });

    return ConvertStockQuote(xmlBody.QuoteData);
  }
}

function UpdateStock(json, stock) {
  stock.LastTradeAmount = Number(json.l.replace(',', '')).toFixed(2);
  stock.LastUpdated = Date();
  return stock;
}

// async function RetrieveWebStockQuote(symbol) {
//   var stock = null;
//   const response = await fetch('http://ws.cdyne.com/delayedstockquote/delayedstockquote.asmx/GetQuote?StockSymbol=' + symbol + '&LicenseKey=0');
//   let body = await response.text();
//   var xmlBody = convert.xml2js(body, {
//     compact: true,
//     spaces: 4
//   });

//   return ConvertStock(xmlBody.QuoteData);
// }

function ConvertGdaxQuote(ticker, currency) {
  let companyName = '';
  switch (currency) {
    case 'ETH':
      companyName = 'Ethereum';
      break;
    case 'BTC':
      companyName = 'Bitcoin';
      break;
    case 'LTC':
      companyName = 'Litecoin';
      break;
  }

  // TODO: All N/A figures can all be gotten from the 'candles' API on GDAX
  var crypto = {
    ChangePercent: 'N/A',
    CompanyName: companyName,
    Symbol: currency,
    DayHigh: 'N/A',
    DayLow: 'N/A',
    FiftyTwoWeekRange: 'N/A',
    LastTradeAmount: Number.parseFloat(ticker.price),
    LastTradeDateTime: Date.parse(ticker.time),
    LastUpdated: Date()
  };

  return crypto;
}

function ConvertStockQuote(quote) {
  var stock = {
    ChangePercent: quote.ChangePercent._text,
    CompanyName: quote.CompanyName._text,
    Symbol: quote.StockSymbol._text,
    DayHigh: quote.DayHigh._text,
    DayLow: quote.DayLow._text,
    FiftyTwoWeekRange: quote.FiftyTwoWeekRange._text,
    LastTradeAmount: quote.LastTradeAmount._text,
    LastTradeDateTime: quote.LastTradeDateTime._text,
    LastUpdated: Date()
  };

  return stock;
}

async function processMarket() {
  if (myChannel && checkMarketOpen(false)) {
    // myChannel.sendMessage("processing orders...");
    for (let i = orders.length - 1; i >= 0; i--) {
      let currentOrder = orders[i];
      let stock = await getStock(currentOrder.symbol);
      if (stock) {
        if ((currentOrder.type == "stop" && currentOrder.price <= stock.LastTradeAmount) ||
          currentOrder.type == "limit" && currentOrder.price >= stock.LastTradeAmount) {
          if (currentOrder.action == "BUY") {
            buyStock(users[currentOrder.userId], stock, currentOrder.amount);
          } else {
            sellStock(users[currentOrder.userId], stock, currentOrder.amount);
          }

          myChannel.sendMessage(currentOrder.type.toUpperCase() + " " +
            currentOrder.action.toUpperCase() + " ORDER completed for " +
            users[currentOrder.userId].username);

          // removed processed order
          orders.splice(i, 1);
        }
      }
    }

    setItem('orders', orders);
  }
}

function buyStock(user, stock, amount) {
  if (checkMarketOpen(true, stock)) {
    if (stock && user && amount > 0) {
      if (user.cash - stock.LastTradeAmount * amount > 0) {
        if (!user.stocks[stock.Symbol]) {
          user.stocks[stock.Symbol] = 0;
          user.costBasis[stock.Symbol] = 0;
        }

        user.cash -= stock.LastTradeAmount * amount;

        user.stocks[stock.Symbol] += amount;
        user.costBasis[stock.Symbol] += stock.LastTradeAmount * amount;
        user.trades.push({
          timestamp: Date(),
          tradeType: "BUY",
          symbol: stock.Symbol,
          amount: amount,
          price: stock.LastTradeAmount
        })

        setItem('users', users);
        myChannel.sendMessage("<@" + user.userUid + ">```BUY: " + stock.Symbol + "\t AMOUNT: " + amount +
          "\t PRICE: $" + stock.LastTradeAmount.toFixed(2) + "\t\nTOTAL: $" + (stock.LastTradeAmount * amount).toFixed(2) + "```");
      } else {
        myChannel.sendMessage("<@" + user.userUid + ">\n you are short $" + Math.abs(user.cash - stock.LastTradeAmount * amount).toFixed(2) + " for this transaction");
      }
    }
  }
}

function calculcatePerformance(user, stock) {
  if (user.stocks[stock.Symbol]) {
    let currentValue = user.stocks[stock.Symbol] * stock.LastTradeAmount;
    let performance = (((currentValue - user.costBasis[stock.Symbol]) / user.costBasis[stock.Symbol]) * 100).toFixed(2);

    return performance;
  }

  return 0;
}

function resetCostBasis(user) {
  for (let costBasis in user.costBasis) {
    user.costBasis[costBasis] = undefined;
  }

  for (let i = 0; i < user.trades.length; i++) {
    let trade = user.trades[i];
    if (trade.tradeType === "BUY") {
      trade.sold = undefined;
    }
    if (trade.tradeType === "SELL") {
      trade.calculated = undefined;
    }
  }


  return adjustCostBasis(user);
}

function adjustCostBasis(user) {
  console.log("Adjusting Cost Basis: " + user.username);
  //todo improve this, or not
  for (let costBasis in user.costBasis) {
    if (costBasis == null || costBasis == undefined || isNaN(costBasis)) {
      let stockAmount = user.stocks[costBasis];
      user.costBasis[costBasis] = 0;
      if (stockAmount) {
        for (let i = user.trades.length - 1; i >= 0; i--) {
          let trade = user.trades[i];
          if (trade.tradeType === "BUY" && trade.symbol == costBasis && user.stocks[costBasis]) {
            user.costBasis[costBasis] += trade.price * trade.amount;
            stockAmount -= trade.amount;
            if (stockAmount <= 0) {
              break;
            }
          }
        }
      } else {
        user.costBasis[costBasis] = 0;
      }
    }
  }

  for (let i = 0; i < user.trades.length; i++) {
    let trade = user.trades[i];
    if (trade.tradeType === "SELL" && trade.calculated === undefined) {
      console.log("Found uncalculated trade: " + trade.symbol + " for " + trade.price + " of " + trade.amount + " shares.");
      console.log("Cost Basis: " + user.costBasis[trade.Symbol]);
      let sellAmount = trade.amount;
      for (let j = 0; j < user.trades.length; j++) {
        let buyTrade = user.trades[j];
        if (buyTrade.tradeType === "BUY" &&
          buyTrade.symbol === trade.symbol &&
          (buyTrade.sold === undefined || buyTrade.sold < buyTrade.amount)) {
          if (buyTrade.sold === undefined) {
            buyTrade.sold = 0;
          }

          if (buyTrade.sold + sellAmount > buyTrade.amount) {
            sellAmount -= buyTrade.amount - buyTrade.sold;
            user.costBasis[trade.symbol] -= (buyTrade.amount - buyTrade.sold) * buyTrade.price;
            buyTrade.sold = buyTrade.amount;
          } else {
            user.costBasis[trade.symbol] -= (sellAmount) * buyTrade.price;
            buyTrade.sold += sellAmount;
            sellAmount = 0;
            trade.calculated = true;
            console.log("Final Cost Basis: " + user.costBasis[trade.symbol]);
            break;
          }
        }
      }
    }
  }

  users[user.userId] = user;

  setItem('users', users);

  return user;
}

function sellStock(user, stock, amt) {
  if (checkMarketOpen(true, stock)) {
    if (stock && user && amt > 0) {
      if (user.stocks[stock.Symbol] && user.stocks[stock.Symbol] >= amt) {
        user.stocks[stock.Symbol] -= amt;
        if (user.stocks[stock.Symbol] == 0) {
          delete user.stocks[stock.Symbol];
        }

        user.cash += stock.LastTradeAmount * amt;

        myChannel.sendMessage("<@" + user.userUid + ">```SELL: " + stock.Symbol + "\t AMOUNT: " + amt + "\t PRICE: $" +
          stock.LastTradeAmount.toFixed(2) + "\t \nTOTAL: $" + (stock.LastTradeAmount * amt).toFixed(2) + "```");
        user.trades.push({
          timestamp: Date(),
          tradeType: "SELL",
          symbol: stock.Symbol,
          amount: amt,
          price: stock.LastTradeAmount
        });

        setItem('users', users);
      } else {

        myChannel.sendMessage("<@" + user.userUid + ">\nyou dont have this many shares to sell!");
      }
    }
  }
}

function checkMarketOpen(showMessage, stock) {
  if (stock.Symbol === 'ETH' || stock.Symbol === 'BTC' || stock.Symbol === 'LTC') {
    return true; // crypto is always open!!
  }

  let hour = new Date().getUTCHours();
  let day = new Date().getUTCDay();
  let minute = new Date().getUTCMinutes();
  if ((hour > 13 || (hour == 13 && minute == 30)) && hour < 20 && day <= 5) {
    return true;
  }

  if (showMessage) {
    myChannel.sendMessage("Markets are closed, no orders can be made until they reopen. \nNew York Stock Exchange is open Mon-Fri, 9:30AM-4:00PM");
  }

  return false;
}

async function registerUser(userId, message) {
  if (users[userId] != null) {
    console.log(market.length)
    let summary = await getSummary(userId);
    message.reply("foreited:\n" + summary);
    users[userId] = null;
  }

  message.reply("welcome!\nEnjoy this **$10,000** on the house!\n" + printRules());
  users[userId] = {
    userId: userId,
    userUid: message.author.id,
    username: message.author.username,
    cash: 10000,
    stocks: {},
    costBasis: {},
    watching: [],
    trades: [],
  }

  setItem('users', users);
}

function printRules() {
  return "```All players start with $10,000\nMarkets open at 9AM EST\nMarkets close at 5PM EAST\nTrades are free\nPortfolios are public\nDaily performance is reported at market close\n```"
}

function printCommands() {
  return `**Bot Commands**\n\`\`\`
  #register\tRegisters user with the bot. Also can be used to reset account.\n\n
  #portfolio\tDisplays the users current portfolio\n\n
  #cash\tQuickly shows your remaining cash\n\n
  #quote SYM \tQueries the market for a quote on a specific stock.\nex: #quote MSFT\n\n
  #buy SYM AMT\tbuys stock with symbol 'SYM' in amount 'AMT'\nex: #buy MSFT 5\n\n
  #sell SYM AMT\tsells stock with symbol 'SYM' in amount 'AMT'\nex: #sell MSFT 5\n\n
  #limit order BUY/SELL STOCK AMOUNT PRICE\tWill buy/sell a defined number of shares the next it goes below defined price\nex: #limit order buy MSFT 5 69\n\n
  #stop order BUY/SELL STOCK AMOUNT PRICE\tWill buy/sell a defined number of shares the next it goes above defined price\nex: #stop order sell MSFT 5 75\n\n
  #list orders\tLists the users pending orders\n\n
  #delete order ORDERID\tDeletes a pending order with the matching orderId\n\n
  \`\`\``;
}

function printChangeList() {
  return `**Changelist**\n\`\`\`Removed 3-4 character restrictions on Symbols\n\`\`\``
}

async function getSummary(userId) {
  var output = "";
  if (users[userId]) {
    var user = users[userId];
    user = resetCostBasis(user);
    var netWorth = 0;
    var stockList = '';
    var totalCostBasis = 0;
    for (let stock in user.stocks) {
      let stockValue = await getStock(stock);
      let performance = calculcatePerformance(user, stockValue);
      if (performance > 0) {
        performance = '+' + performance;
      }

      netWorth += stockValue.LastTradeAmount * user.stocks[stock];
      totalCostBasis += user.costBasis[stock];
      stockList += stock + '\t' + user.stocks[stock] + ' shares\t' + performance + '%\tvalue: $' + (stockValue.LastTradeAmount * user.stocks[stock]).toFixed(2) + '\tbasis: $' + user.costBasis[stock].toFixed(2) + '\tprice: $' + stockValue.LastTradeAmount.toFixed(2) + '\n';
    }

    output += "Total Net Worth: $" + (user.cash + netWorth).toFixed(2) + '\n';
    output += "Total Cost Basis: $" + totalCostBasis.toFixed(2) + "\n";
    output += "Total Stock Worth: $" + netWorth.toFixed(2) + "\n";
    output += 'Cash: $' + user.cash.toFixed(2) + '\n';
    if (Object.keys(user.stocks).length > 0) {
      output += "Total Stock Performance: " + (100 * (netWorth - totalCostBasis) / totalCostBasis).toFixed(2) + "%\n";;
      output += 'Stocks: \n```';
      output += stockList;
      output += '```\n';
    } else {
      output += "¯\\_(ツ)\_/¯"
    }

  } else {
    output = userId + "not registed with Stockbot";
  }

  return output;
}


async function printLeaderboard() {
  var leaderboard = [];
  for (let userId in users) {
    let user = users[userId];
    var netWorth = -10000;
    for (let stock in user.stocks) {
      let stockValue = await getStock(stock);
      netWorth += stockValue.LastTradeAmount * user.stocks[stock];
    }

    netWorth += user.cash;
    leaderboard.push({ name: user.username, networth: netWorth });
  }

  leaderboard.sort(function (a, b) {
    return b.networth - a.networth;
  });

  var leads = "**Leaderboard**\n```";
  for (let i = 0; i < leaderboard.length; i++) {
    user = leaderboard[i];
    leads += "#" + (i + 1) + "   " + user.name + "\n     $" + user.networth.toFixed(2) + "\n\n";
  }

  leads += "```";

  myChannel.sendMessage(leads);
}

function formatQuote(quote) {
  var output = "";
  output += "**" + quote.StockSymbol._text + "**" + " \t _" + quote.CompanyName._text + "_\n";
  output += "```" + "Last Trade Amount: $" + quote.LastTradeAmount._text + "\n";
  output += "Day Change: " + quote.ChangePercent._text + "\n";
  output += "Day High/Low: " + quote.DayHigh._text + " / " + quote.DayLow._text + "\n";
  output += "Year Range: " + quote.FiftyTwoWeekRange._text + "\n";
  output += "```";

  return output;
}

function formatCryptoQuote(ticker, currency) {
  var output = "";
  output += "**" + currency + "**" + " \t _" + ticker.CompanyName + "_\n";
  output += "```" + "Last Trade Amount: $" + ticker.LastTradeAmount.toFixed(2) + "\n";
  //output += "Day Change: " + ticker.ChangePercent + "\n";
  //output += "Day High/Low: " + ticker.DayHigh + " / " + ticker.DayLow + "\n";
  //output += "Year Range: " + ticker.FiftyTwoWeekRange + "\n";
  output += "```";

  return output;
}

client.login(botKey.apiKey());

//thanks https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}