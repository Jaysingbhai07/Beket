/**
 * Telegram Bot Backend - Vercel Serverless Function
 * Path: /api/telegram.js
 */

const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    increment, 
    serverTimestamp, 
    runTransaction 
} = require('firebase/firestore');

// --- 1. CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBbqNPQfhPHqZuhZM2zzGQnf4f53Sw-jrU",
    authDomain: "tasksearningsbot.firebaseapp.com",
    projectId: "tasksearningsbot",
    storageBucket: "tasksearningsbot.firebasestorage.app",
    messagingSenderId: "721160571309",
    appId: "1:721160571309:web:35d389bf57f511e6a73924"
};

// Vercel Environment Variables se Token uthayen
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token);

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// --- 2. CORE FUNCTIONS ---

/**
 * Referral logic ko atomic transaction ke saath handle karega
 * Taaki duplicate rewards na diye ja saken.
 */
async function processReferralReward(userId, referrerId) {
    if (!referrerId || userId === referrerId) return;

    const userRef = doc(db, "users", userId.toString());
    const referrerRef = doc(db, "users", referrerId.toString());
    const rewardRef = doc(db, "ref_rewards", userId.toString());

    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const rewardDoc = await transaction.get(rewardRef);

            // Conditions: User naya ho, pehle reward na mila ho, aur frontend open flag true ho
            if (userDoc.exists() && !userDoc.data().rewardGiven && !rewardDoc.exists()) {
                
                // 1. Referrer ko 500 coins aur +1 referral count dein
                transaction.update(referrerRef, {
                    coins: increment(500),
                    reffer: increment(1)
                });

                // 2. Current user ko mark karein ki reward process ho gaya hai
                transaction.update(userRef, {
                    rewardGiven: true
                });

                // 3. Ledger entry create karein idempotency ke liye
                transaction.set(rewardRef, {
                    userId: userId,
                    referrerId: referrerId,
                    reward: 500,
                    createdAt: serverTimestamp()
                });
            }
        });
        console.log(`Referral reward processed for referrer: ${referrerId}`);
    } catch (error) {
        console.error("Referral Transaction Error:", error);
    }
}

/**
 * User ko create ya update karega aur welcome message bhejega
 */
async function handleStartCommand(msg) {
    const userId = msg.from.id;
    const firstName = msg.from.first_name;
    const photoURL = `https://ui-avatars.com/api/?name=${firstName}&background=random`;
    
    // Extract referral ID: "/start 12345" -> "12345"
    const startParam = msg.text.split(' ')[1] || null;

    const userRef = doc(db, "users", userId.toString());
    const userSnap = await getDoc(userRef);

    let isNewUser = false;

    if (!userSnap.exists()) {
        isNewUser = true;
        // User document create karein
        await setDoc(userRef, {
            id: userId,
            name: firstName,
            photoURL: photoURL,
            coins: 0,
            reffer: 0,
            refferBy: startParam,
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: true, // Auto mark true
            rewardGiven: false,
            createdAt: serverTimestamp()
        });
    }

    // Agar naya user hai aur referral link se aaya hai
    if (isNewUser && startParam) {
        await processReferralReward(userId, startParam);
    }

    // Response Message
    const welcomeText = `👋 Hi! Welcome ${firstName} ⭐\nYaha aap tasks complete karke real rewards kama sakte ho!\n\n🔥 Daily Tasks\n🔥 Video Watch\n🔥 Mini Apps\n🔥 Referral Bonus\n🔥 Auto Wallet System\n\nReady to earn?\nTap START and your journey begins!`;

    const options = {
        caption: welcomeText,
        reply_markup: {
            inline_keyboard: [
                [{ text: "▶ Open App", web_app: { url: "https://jaysingbhai07.github.io/Tasks-earnings-bot/" } }],
                [
                    { text: "📢 Channel", url: "https://t.me/finisher_tech" },
                    { text: "🌐 Community", url: "https://t.me/finisher_techg" }
                ]
            ]
        }
    };

    // Welcome Image bhejein
    await bot.sendPhoto(userId, "https://i.ibb.co/CKK6Hyqq/1e48400d0ef9.jpg", options);
}

// --- 3. VERCEL WEBHOOK HANDLER ---

module.exports = async (req, res) => {
    // Sirf POST requests allow karein (Telegram Webhook POST bhejta hai)
    if (req.method !== 'POST') {
        return res.status(200).send('Bot is running');
    }

    try {
        const { body } = req;

        // Agar message text hai
        if (body.message && body.message.text) {
            const text = body.message.text;

            if (text.startsWith('/start')) {
                await handleStartCommand(body.message);
            }
        }

        // Telegram ko 200 OK bhej dena zaroori hai turant
        res.status(200).send('OK');

    } catch (error) {
        console.error('Main Handler Error:', error);
        // Error hone par bhi 200 bhejte hain taaki Telegram retry loop mein na phanse
        res.status(200).send('Error handled');
    }
};
