#!/usr/bin/env python3
"""Operator entrypoint: reviewed privacy UI and approved-policy communication cleanup."""
import sys
from wizard_release import main,PRIVACY_LOGGER_RELEASE
if __name__=='__main__':
    try:main(default_release=PRIVACY_LOGGER_RELEASE)
    except Exception as error:
        import deploy
        deploy.report_failure(error);sys.exit(1)
