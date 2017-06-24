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
*/

function setItem(key, value) {
  storage.setItem(key, value);
}

storage.init().then(function () {

  var values = storage.values();
  storage.getItem('version', async function (err, value) {
    if (value === undefined) {
      console.log("NEW BOT OR FILE FAULT, NO USERS FILE DETECTED. CREATING...");
      await storage.setItem("users", users);
      await storage.setItem("market", market);
      await storage.setItem("myChannel", myChannel);
      await storage.setItem("orders", orders);
      await storage.setItem("marketMonitorRate", marketMonitorRate);
      await storage.setItem("version", version);
    } else {
      console.log("PREVIOUS ");
      version = value;
      users = await storage.getItem("users");
      market = await storage.getItem("market");
      myChannel = await storage.getItem("myChannel");
      orders = await storage.getItem("orders");
      marketMonitorRate = await storage.getItem("marketMonitorRate");
    }
  }).then(() => {

    client.on('ready', () => {
      console.log(botKey.apiKey());
      setInterval(processMarket, 5000);
    });

    client.on('message', async function (message) {
      if (message.content.startsWith("#monitor channel")) {
        myChannel = message.channel;
        setItem('myChannel', myChannel);

        myChannel.sendMessage("Monitoring #" + message.channel.name);
      }

      if (message.content.startsWith("#quote")) {
        try {
          var stock = message.content.slice(6, message.content.length).trim();
          if (stock.length == 3 || stock.length == 4) {
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
        if (user && (params[0].length == 3 || params[0].length == 4) && !isNaN(params[1])) {
          var amt = Number(params[1]);
          var stock = await getStock(params[0].toUpperCase());
          if (stock) {
            if (user.cash - stock.LastTradeAmount * amt > 0) {
              message.reply("```BUY: " + stock.Symbol + "\t AMOUNT: " + amt +
                "\t PRICE: $" + stock.LastTradeAmount + "\t\nTOTAL: $" + (stock.LastTradeAmount * amt).toFixed(2) + "```");
              if (!user.stocks[stock.Symbol]) {
                user.stocks[stock.Symbol] = 0;
              }

              user.cash -= stock.LastTradeAmount * amt;
              user.stocks[stock.Symbol] += amt;
              user.trades.push({
                timestamp: Date(),
                tradeType: "BUY",
                symbol: stock.Symbol,
                amount: amt,
                price: stock.LastTradeAmount
              })

              setItem('users', users);
            } else {
              message.reply("you are short $" + Math.abs(user.cash - stock.LastTradeAmount * amt).toFixed(2) + " for this transaction");
            }
          }
        }
      }

      if (message.content.startsWith("#sell")) {
        var command = message.content.slice(5, message.content.length).trim();
        var params = command.split(' ');
        var user = users[message.author.tag];
        if (user && (params[0].length == 3 || params[0].length == 4) && !isNaN(params[1])) {
          var stock = await getStock(params[0].toUpperCase());
          var amt = Number(params[1]);
          if (stock) {
            if (user.stocks[stock.Symbol] && user.stocks[stock.Symbol] >= amt) {
              user.stocks[stock.Symbol] -= amt;
              user.cash += stock.LastTradeAmount * amt;
              message.reply("```SELL: " + stock.Symbol + "\t AMOUNT: " + params[1] + "\t PRICE: $" +
                stock.LastTradeAmount + "\t \nTOTAL: $" + (stock.LastTradeAmount * amt) + "```");
              user.trades.push({
                timestamp: Date(),
                tradeType: "SELL",
                symbol: stock.Symbol,
                amount: params[1],
                price: stock.LastTradeAmount
              });

              setItem('users', users);
            } else {
              message.reply("you dont have this many shares to sell!");
            }
          }
        }
      }

      if (message.content.startsWith("#limit order") || message.content.startsWith("#stop order")) {
        var command = message.content.slice(message.content.startsWith("#stop") ? 5 : 6, message.content.length).trim();
        var params = command.split(' ');
        var user = users[message.author.tag];
        if (user &&
          (params[0].toUpperCase() == "BUY" || params[0].toUpperCase() == "SELL") &&
          (params[1].length == 3 || params[1].length == 4) &&
          !isNaN(params[2]) &&
          !isNaN(params[3])) {
          var orderType = params[0].toUpperCase();
          var stock = await getStock(params[1].toUpperCase());
          var amt = Number(params[2]);
          var orderPrice = Number(params[3]);
          orders.push({
            userId: message.author.tag,
            symbol: stock,
            amount: amt,
            price: orderPrice,
            action: orderType,
            type: message.content.startsWith("#stop") ? "stop" : "limit",
            timestamp: Date()
          })

          setItem('orders', orders);
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
});



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
  var stock = null;
  const response = await fetch('http://ws.cdyne.com/delayedstockquote/delayedstockquote.asmx/GetQuote?StockSymbol=' + symbol + '&LicenseKey=0');
  let body = await response.text();
  var xmlBody = convert.xml2js(body, {
    compact: true,
    spaces: 4
  });

  return ConvertStock(xmlBody.QuoteData);
}

function ConvertStock(quote) {
  var stock = {
    ChangePercent: quote.ChangePercent._text,
    CompanyName: quote.CompanyName._text,
    Symbol: quote.StockSymbol._text,
    DayHigh: quote.DayHigh._text,
    DayLow: quote.DayLow._text,
    FiftyTwoWeekRange: quote.FiftyTwoWeekRange._text,
    LastTradeAmount: quote.LastTradeAmount._text,
    LastTradeDateTime: quote.LastTradeDateTime._text,
    OpenAmount: quote.OpenAmount._text,
    PreviousClose: quote.PrevCls._text,
    PE: quote.PE._text,
    StockChange: quote.StockChange._text,
    StockVolume: quote.StockVolume._text,
    LastUpdated: Date()
  };

  return stock;
  // market[stock.Symbol];
}

function processMarket() {
  if (myChannel) {
    myChannel.sendMessage("processing orders...");
    for (let i = orders.length - 1; i >= 0; i--) {
      let currentOrder = orders[i];
      let stock = getStock(currentOrder.symbol);
      if (stock) {
        if ((currentOrder.type == "stop" && currentOrder.price <= stock.LastTradeAmount) ||
          currentOrder.type == "limit" && currentOrder.price >= stock.LastTradeAmount) {
          if (currentOrder.action == "buy") {
            buyStock(users[currentOrder.userId], stock, amount);
          } else {
            sellStock(users[currentOrder.userId], stock, amount);
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
  if (stock && user && amount > 0) {
    if (user.cash - stock.LastTradeAmount * amount > 0) {
      if (!user.stocks[stock.Symbol]) {
        user.stocks[stock.Symbol] = 0;
      }

      user.cash -= stock.LastTradeAmount * amount;
      user.stocks[stock.Symbol] += amount;
      user.trades.push({
        timestamp: Date(),
        tradeType: "BUY",
        symbol: stock.Symbol,
        amount: amount,
        price: stock.LastTradeAmount
      })

      setItem('users', users);
      myChannel.sendMessage("<@" + user.userId + ">\n ```BUY: " + stock.Symbol + "\t AMOUNT: " + amount +
        "\t PRICE: $" + stock.LastTradeAmount + "\t\nTOTAL: $" + (stock.LastTradeAmount * amount).toFixed(2) + "```");
    } else {
      myChannel.sendMessage("<@" + user.userId + ">\n you are short $" + Math.abs(user.cash - stock.LastTradeAmount * amount).toFixed(2) + " for this transaction");
    }
  }
}

function sellStock(user, stock, amount) {
  if (stock && user && amount > 0) {
    if (user.stocks[stock.Symbol] && user.stocks[stock.Symbol] >= amt) {
      user.stocks[stock.Symbol] -= amt;
      user.cash += stock.LastTradeAmount * amt;
      message.reply("```SELL: " + stock.Symbol + "\t AMOUNT: " + params[1] + "\t PRICE: $" +
        stock.LastTradeAmount + "\t \nTOTAL: $" + (stock.LastTradeAmount * amt) + "```");
      user.trades.push({
        timestamp: Date(),
        tradeType: "SELL",
        symbol: stock.Symbol,
        amount: params[1],
        price: stock.LastTradeAmount
      });

      setItem('users', users);
    }
  }
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
    username: message.author.username,
    cash: 10000,
    stocks: {},
    watching: [],
    trades: [],
  }

  setItem('users', users);
}

function printRules() {
  return "```All players start with $10,000\nMarkets open at 9AM EST\nMarkets close at 5PM EAST\nTrades are free\nPortfolios are public\nDaily performance is reported at market close\n```"
}

async function getSummary(userId) {
  var output = "";
  if (users[userId]) {
    var user = users[userId];
    var netWorth = user.cash;
    var stockList = '';
    for (let stock in user.stocks) {
      let stockValue = await getStock(stock);
      netWorth += stockValue.LastTradeAmount * user.stocks[stock];
      stockList += stock + ' \t ' + user.stocks[stock] + ' shares \t $' + (stockValue.LastTradeAmount * user.stocks[stock]).toFixed(2) + ' \n';
    }

    output += "Total Net Worth: $" + netWorth.toFixed(2) + '\n';
    output += 'Cash: $' + user.cash.toFixed(2) + '\n';
    output += 'Stocks: \n```';
    output += stockList;
    output += '```\n';

  } else {
    output = userId + "not registed with Stockbot";
  }

  return output;
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

client.login(botKey.apiKey());