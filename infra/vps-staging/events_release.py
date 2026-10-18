#!/usr/bin/env python3
"""Operator entrypoint: confirmed unused-draft deletion and centred sidebar logo."""
import sys
from wizard_release import main,EVENT_UI_RELEASE
if __name__=='__main__':
    try:main(default_release=EVENT_UI_RELEASE)
    except Exception as error:
        import deploy
        deploy.report_failure(error);sys.exit(1)
