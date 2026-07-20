/**
 * API Cache Utility
 * Caches API responses to prevent unnecessary calls
 */

const CACHE_DURATION = 30 * 60 * 1000 // 30 minutes
const CACHE_PREFIX = 'ai_justice_cache_'

export const apiCache = {
  /**
   * Get cached data
   */
  get(key) {
    try {
      const cacheKey = CACHE_PREFIX + key
      const cached = localStorage.getItem(cacheKey)
      
      if (!cached) return null
      
      const { data, timestamp } = JSON.parse(cached)
      const now = Date.now()
      
      // Check if cache is still valid
      if (now - timestamp > CACHE_DURATION) {
        localStorage.removeItem(cacheKey)
        return null
      }
      
      console.log(`✅ Cache HIT for: ${key}`)
      return data
    } catch (error) {
      console.error('Cache get error:', error)
      return null
    }
  },

  /**
   * Set cached data
   */
  set(key, data) {
    try {
      const cacheKey = CACHE_PREFIX + key
      const cacheData = {
        data,
        timestamp: Date.now()
      }
      localStorage.setItem(cacheKey, JSON.stringify(cacheData))
      console.log(`💾 Cached: ${key}`)
    } catch (error) {
      console.error('Cache set error:', error)
    }
  },

  /**
   * Clear specific cache
   */
  clear(key) {
    try {
      const cacheKey = CACHE_PREFIX + key
      localStorage.removeItem(cacheKey)
      console.log(`🗑️ Cleared cache: ${key}`)
    } catch (error) {
      console.error('Cache clear error:', error)
    }
  },

  /**
   * Clear all caches
   */
  clearAll() {
    try {
      const keys = Object.keys(localStorage)
      keys.forEach(key => {
        if (key.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(key)
        }
      })
      console.log('🗑️ Cleared all caches')
    } catch (error) {
      console.error('Cache clearAll error:', error)
    }
  },

  /**
   * Generate cache key for classification
   */
  getClassificationKey(description) {
    // Create a hash-like key from description
    const normalized = description.toLowerCase().trim().substring(0, 100)
    return `classify_${btoa(normalized).substring(0, 20)}`
  },

  /**
   * Generate cache key for court recommendations
   */
  getCourtKey(caseType, city) {
    return `court_${caseType}_${city || 'all'}`
  },

  /**
   * Generate cache key for lawyer recommendations
   */
  getLawyerKey(caseType, city) {
    return `lawyer_${caseType}_${city || 'all'}`
  }
}

/**
 * Debounce utility to prevent rapid API calls
 */
export function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

/**
 * Throttle utility to limit API call frequency
 */
export function throttle(func, limit) {
  let inThrottle
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args)
      inThrottle = true
      setTimeout(() => inThrottle = false, limit)
    }
  }
}
