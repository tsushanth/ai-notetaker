/**
 * Scribe AI Website - Main JavaScript
 */

(function() {
    'use strict';

    // =========================================
    // Mobile Menu Toggle
    // =========================================
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const mobileMenu = document.querySelector('.mobile-menu');
    const nav = document.querySelector('.nav');

    if (mobileMenuBtn && mobileMenu) {
        mobileMenuBtn.addEventListener('click', function() {
            mobileMenuBtn.classList.toggle('active');
            mobileMenu.classList.toggle('active');
            document.body.classList.toggle('menu-open');
        });

        // Close menu when clicking a link
        const mobileLinks = mobileMenu.querySelectorAll('.mobile-menu-link');
        mobileLinks.forEach(function(link) {
            link.addEventListener('click', function() {
                mobileMenuBtn.classList.remove('active');
                mobileMenu.classList.remove('active');
                document.body.classList.remove('menu-open');
            });
        });

        // Close menu when clicking outside
        document.addEventListener('click', function(e) {
            if (!mobileMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
                mobileMenuBtn.classList.remove('active');
                mobileMenu.classList.remove('active');
                document.body.classList.remove('menu-open');
            }
        });
    }

    // =========================================
    // Referral Code Tracking
    // =========================================
    function getReferralCode() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('ref') || urlParams.get('referral');
    }

    function storeReferralCode() {
        const refCode = getReferralCode();
        if (refCode) {
            // Store in localStorage for 30 days
            const expiry = Date.now() + (30 * 24 * 60 * 60 * 1000);
            localStorage.setItem('scribeai_referral', JSON.stringify({
                code: refCode,
                expiry: expiry
            }));
            console.log('Referral code stored:', refCode);
        }
    }

    function getStoredReferralCode() {
        const stored = localStorage.getItem('scribeai_referral');
        if (stored) {
            try {
                const data = JSON.parse(stored);
                if (Date.now() < data.expiry) {
                    return data.code;
                } else {
                    localStorage.removeItem('scribeai_referral');
                }
            } catch (e) {
                localStorage.removeItem('scribeai_referral');
            }
        }
        return null;
    }

    // Store referral code on page load
    storeReferralCode();

    // Add referral code to app store links
    function appendReferralToLinks() {
        const refCode = getStoredReferralCode() || getReferralCode();
        if (refCode) {
            const appStoreLinks = document.querySelectorAll('.app-store-btn');
            appStoreLinks.forEach(function(link) {
                const href = link.getAttribute('href');
                // For deep linking, we might want to pass the referral code
                // This is typically handled differently on iOS/Android
                // For now, we just log it
                console.log('App store link with referral:', refCode, href);
            });
        }
    }

    appendReferralToLinks();

    // =========================================
    // Form Handling
    // =========================================
    function handleFormSubmit(form, successMessage) {
        form.addEventListener('submit', function(e) {
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;

            // Add referral code to form if available
            const refCode = getStoredReferralCode();
            if (refCode) {
                let refInput = form.querySelector('input[name="referral_code"]');
                if (!refInput) {
                    refInput = document.createElement('input');
                    refInput.type = 'hidden';
                    refInput.name = 'referral_code';
                    form.appendChild(refInput);
                }
                refInput.value = refCode;
            }

            // Show loading state
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';

            // For Formspree or similar services, the form will submit normally
            // This just provides visual feedback
            setTimeout(function() {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }, 3000);
        });
    }

    // Initialize forms
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        handleFormSubmit(contactForm, 'Thank you! We\'ll get back to you soon.');
    }

    const creatorForm = document.getElementById('creatorForm');
    if (creatorForm) {
        handleFormSubmit(creatorForm, 'Application submitted! We\'ll review and respond within 48 hours.');
    }

    // =========================================
    // Smooth Scroll for Anchor Links
    // =========================================
    document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // =========================================
    // Navigation Scroll Effect
    // =========================================
    let lastScroll = 0;

    window.addEventListener('scroll', function() {
        const currentScroll = window.pageYOffset;

        if (nav) {
            if (currentScroll > 50) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
        }

        lastScroll = currentScroll;
    });

    // =========================================
    // Intersection Observer for Animations
    // =========================================
    if ('IntersectionObserver' in window) {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const fadeInObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    fadeInObserver.unobserve(entry.target);
                }
            });
        }, observerOptions);

        // Observe elements that should fade in
        const fadeElements = document.querySelectorAll('.feature-card, .step-card, .persona-card, .testimonial-card');
        fadeElements.forEach(function(el) {
            el.classList.add('fade-in');
            fadeInObserver.observe(el);
        });
    }

    // =========================================
    // Analytics Event Tracking (placeholder)
    // =========================================
    function trackEvent(category, action, label) {
        // Placeholder for analytics tracking
        // Can be connected to Google Analytics, Mixpanel, etc.
        console.log('Event:', category, action, label);

        // Example for Google Analytics 4:
        // if (typeof gtag !== 'undefined') {
        //     gtag('event', action, {
        //         event_category: category,
        //         event_label: label
        //     });
        // }
    }

    // Track app store button clicks
    document.querySelectorAll('.app-store-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const store = this.href.includes('apple.com') ? 'App Store' : 'Google Play';
            trackEvent('Download', 'Click', store);
        });
    });

})();
