import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { CONFIG } from '../core/appCore'

const app = initializeApp(CONFIG.FIREBASE)

export const db = getDatabase(app)
